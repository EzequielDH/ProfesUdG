from flask import Flask, jsonify, request, send_from_directory, redirect, session, render_template, url_for, abort
import pandas as pd
import glob, os, re, math, sqlite3, hashlib, hmac, secrets, smtplib, threading, json as _json, urllib.request, urllib.error, urllib.parse, uuid
from functools import wraps
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

# Config

def _send_email_thread(to_email, subject, html_body):
    user = os.environ.get('SMTP_USER') or os.environ.get('EMAIL_SENDER', '').strip()
    passwd = os.environ.get('SMTP_PASS') or os.environ.get('EMAIL_PASSWORD', '').strip()
    server_host = os.environ.get('SMTP_SERVER', 'smtp.gmail.com').strip()
    server_port = int(os.environ.get('SMTP_PORT', '465'))

    if not user or not passwd or not to_email:
        print(f"[Email Notification Skipped] to: {to_email} (SMTP_USER='{user}' or SMTP_PASS configured: {'Sí' if passwd else 'No'})", flush=True)
        return

    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = f"ProfesUdG Soporte <{user}>"
        msg['To'] = to_email

        part = MIMEText(html_body, 'html', 'utf-8')
        msg.attach(part)

        sent = False
        # Intento 1: Puerto 465 SSL directo (ultra rápido y no bloqueado por DigitalOcean)
        try:
            server = smtplib.SMTP_SSL(server_host, 465, timeout=10)
            server.login(user, passwd)
            server.sendmail(user, [to_email], msg.as_string())
            server.quit()
            sent = True
        except Exception as err1:
            print(f"[Email Warning] Intento 1 en puerto 465 SSL falló ({err1}). Intentando puerto 587...", flush=True)
            # Intento 2: Fallback a puerto 587 TLS
            try:
                server = smtplib.SMTP(server_host, 587, timeout=10)
                server.starttls()
                server.login(user, passwd)
                server.sendmail(user, [to_email], msg.as_string())
                server.quit()
                sent = True
            except Exception as err2:
                print(f"[Email Error] Intento 2 en puerto 587 también falló: {err2}", flush=True)
                raise err1

        if sent:
            print(f"[Email Sent Successfully] To: {to_email} | Subject: {subject}", flush=True)
    except Exception as e:
        print(f"[Email Error] No se pudo enviar correo a {to_email}: {e}", flush=True)

def send_email_async(to_email, subject, html_body):
    threading.Thread(target=_send_email_thread, args=(to_email, subject, html_body), daemon=True).start()
BASE_URL       = os.environ.get('BASE_URL', 'http://localhost:5001')
ADMIN_USER     = os.environ.get('user_admin', 'admin')
ADMIN_PASS     = os.environ.get('pass_admin')

# SECRET_KEY firma las cookies de sesión. NUNCA usar un valor fijo conocido
# (estaría en el repo público → cualquiera podría falsificar la sesión de admin).
# Si no está configurada, se genera una aleatoria efímera (las sesiones se
# reinician al reiniciar el servidor, aceptable en desarrollo).
SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    SECRET_KEY = secrets.token_hex(32)
    print("[seguridad] SECRET_KEY no configurada — usando una aleatoria temporal. "
          "Define SECRET_KEY en producción para mantener sesiones entre reinicios.")

# Si no se definió contraseña de admin, se genera una aleatoria y se imprime,
# en vez de usar una contraseña por defecto conocida públicamente.
if not ADMIN_PASS:
    ADMIN_PASS = secrets.token_urlsafe(12)
    print(f"[seguridad] pass_admin no configurada — contraseña temporal generada: {ADMIN_PASS}")

GOOGLE_CLIENT_ID     = os.environ.get('GOOGLE_CLIENT_ID') or os.environ.get('ID-client', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET') or os.environ.get('Secret-client', '')
GOOGLE_REDIRECT_URI  = os.environ.get('GOOGLE_REDIRECT_URI', 'http://localhost:5001/api/auth/callback')

def _popup_response(status):
    msg = status if status in ('ok', 'denied', 'error') else 'error'
    fallback = f'/?auth={msg}'
    label = '✓ Verificado' if msg == 'ok' else ('✗ No autorizado' if msg == 'denied' else 'Error al verificar')
    return (
        f'<!DOCTYPE html><html><head><meta charset="UTF-8"><script>(function(){{'
        f'try{{localStorage.setItem("_gauth","{msg}");}}catch(e){{}}'
        f'if(window.opener&&!window.opener.closed){{'
        f'try{{window.opener.postMessage({{type:"google-auth",status:"{msg}"}},window.location.origin);}}catch(e){{}}'
        f'}}'
        f'setTimeout(function(){{try{{window.close();}}catch(e){{}}window.location.href="{fallback}";}},300);'
        f'}})();</script></head>'
        f'<body style="font-family:sans-serif;text-align:center;padding:48px 24px;">'
        f'<p style="font-size:20px;">{label}</p>'
        f'<p style="font-size:13px;color:#888;">Cerrando ventana...</p>'
        f'</body></html>'
    )

serializer = URLSafeTimedSerializer(SECRET_KEY)

# Paths

_BASE = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR  = os.path.join(_BASE, '..', 'frontend')
DATA_DIR      = os.path.join(_BASE, 'data')
PROFES_DIR    = os.path.join(_BASE, 'data', 'profes')
DB_PATH       = os.path.join(_BASE, 'reviews.db')
TEMPLATES_DIR = os.path.join(_BASE, 'templates')
UPLOADS_DIR   = os.path.join(_BASE, 'uploads')
os.makedirs(UPLOADS_DIR, exist_ok=True)

ALLOWED_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='', template_folder=TEMPLATES_DIR)
app.secret_key = SECRET_KEY

# ¿Estamos en producción? (BASE_URL con https) — activa cookies solo-HTTPS
_IS_PROD = BASE_URL.startswith('https://')

app.config.update(
    SESSION_COOKIE_HTTPONLY=True,        # JS no puede leer la cookie (mitiga XSS→robo de sesión)
    SESSION_COOKIE_SAMESITE='Lax',       # el navegador no envía la cookie en POST de otros sitios (mitiga CSRF)
    SESSION_COOKIE_SECURE=_IS_PROD,      # solo viaja por HTTPS en producción
    MAX_CONTENT_LENGTH=5 * 1024 * 1024,  # límite de 5 MB por petición (evita DoS por subida gigante)
)

# Detrás de un proxy (Nginx/Cloudflare) la IP real viene en X-Forwarded-For.
# SOLO confiar en esa cabecera si TRUST_PROXY=1, porque si NO hay proxy un
# atacante podría falsificarla para evadir el rate limiting.
if os.environ.get('TRUST_PROXY') == '1':
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

from flask import has_request_context

def _client_ip():
    try:
        if has_request_context():
            if request.headers.getlist("X-Forwarded-For"):
                return request.headers.getlist("X-Forwarded-For")[0].split(',')[0].strip()
            return get_remote_address()
    except Exception:
        pass
    return "127.0.0.1"

# Rate limiting — limita peticiones por IP real para frenar spam y DoS
from flask_limiter import Limiter
limiter = Limiter(key_func=_client_ip, app=app, default_limits=["10000 per hour"])

def _throttle_ok(key, max_hits, window_seconds):
    """True si la acción se permite; False si supera el límite en la ventana."""
    now = _time.time()
    # Cota de memoria: si crece demasiado (muchas IPs), se vacía por completo.
    if len(_throttle_store) > 50000:
        _throttle_store.clear()
    bucket = [t for t in _throttle_store.get(key, []) if now - t < window_seconds]
    if len(bucket) >= max_hits:
        _throttle_store[key] = bucket
        return False
    bucket.append(now)
    _throttle_store[key] = bucket
    return True

def _safe_int(val, default, lo=None, hi=None):
    """Convierte a int sin lanzar error (evita 500 con ?limit=abc) y acota el rango."""
    try:
        n = int(val)
    except (ValueError, TypeError):
        n = default
    if lo is not None: n = max(lo, n)
    if hi is not None: n = min(hi, n)
    return n

def _safe_google_photo(url):
    """Solo acepta fotos servidas por Google (evita URLs externas de rastreo)."""
    try:
        host = urllib.parse.urlparse(str(url)).netloc.lower()
    except Exception:
        return None
    return str(url)[:400] if host.endswith('googleusercontent.com') else None

# Cabeceras de seguridad en todas las respuestas
@app.after_request
def _security_headers(resp):
    resp.headers['X-Frame-Options']        = 'DENY'              # no se puede meter en un iframe (anti-clickjacking)
    resp.headers['X-Content-Type-Options'] = 'nosniff'          # el navegador respeta el Content-Type declarado
    resp.headers['Referrer-Policy']        = 'strict-origin-when-cross-origin'
    resp.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "img-src 'self' https: data:; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; "
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://js.stripe.com https://www.googletagmanager.com; "
        "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://buy.stripe.com; "
        "connect-src 'self' https://api.stripe.com https://www.google-analytics.com; "
        "frame-ancestors 'none'"
    )
    if _IS_PROD:   # fuerza HTTPS en navegadores durante 1 año
        resp.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return resp

# Defensa CSRF: en peticiones que modifican datos (POST), el header Origin/Referer
# debe coincidir con el host. Un fetch del mismo sitio lo cumple; un ataque CSRF
# desde otro dominio no puede falsificar el header Origin.
@app.before_request
def _csrf_origin_check():
    if request.method in ('POST', 'PUT', 'DELETE', 'PATCH'):
        origin = request.headers.get('Origin') or request.headers.get('Referer', '')
        if origin:
            from urllib.parse import urlparse
            if urlparse(origin).netloc != request.host:
                abort(403)

centros = {
    "CUAAD": "A", "CUCBA": "B", "CUCEA": "C",
    "CUCEI": "D", "CUCS": "E", "CUCSH": "F", "CUALTOS": "G",
    "CUCIENEGA": "H", "CUCOSTA": "I", "CUCSUR": "J", "CUSUR": "K",
    "CUVALLES": "M", "CUNORTE": "N", "CUTONALA": "Z", "UDG_VIRTUAL": "X",
    "CU_TLAJOMULCO": "3", "CU_GUADALAJARA": "4", "CU_TLAQUEPAQUE": "5", "CU_CHAPALA": "6"
}

_cache_historicos = {}
_cache_oferta     = {}

# Database Setup

def init_db():
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
    except Exception:
        pass
    conn.execute('''
        CREATE TABLE IF NOT EXISTS reviews (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            profesor_nombre  TEXT    NOT NULL,
            cu               TEXT    NOT NULL,
            ciclo            TEXT,
            materia          TEXT,
            rating_general   REAL    NOT NULL,
            rating_claridad  REAL,
            rating_dificultad REAL,
            recomienda       INTEGER,
            calificacion     REAL,
            texto            TEXT,
            email_hash       TEXT,
            verificada       INTEGER DEFAULT 0,
            nombre_mostrado  TEXT,
            created_at       TEXT    DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_prof  ON reviews(profesor_nombre, cu)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_email ON reviews(email_hash)')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS support_tickets (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            descripcion TEXT    NOT NULL,
            foto_nombre TEXT,
            email       TEXT,
            estado      TEXT    DEFAULT 'pendiente',
            created_at  TEXT    DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS page_visits (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            page       TEXT    DEFAULT '/',
            created_at TEXT    DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Migrations for existing databases
    for col in ['calificacion REAL', 'censored INTEGER DEFAULT 0', 'foto_url TEXT']:
        try:
            conn.execute(f'ALTER TABLE reviews ADD COLUMN {col}')
        except Exception:
            pass
    try:
        conn.execute("ALTER TABLE support_tickets ADD COLUMN nota_resolucion TEXT")
    except Exception:
        pass
    try:
        conn.execute("UPDATE reviews SET email_hash = NULL WHERE email_hash LIKE 'ip:%'")
    except Exception:
        pass
    conn.commit()
    conn.close()

init_db()

# Helpers

def formatear_hora(h):
    if h == 0: return "00:00"
    s = str(h).zfill(4)
    return f"{s[:2]}:{s[2:]}"

def formatear_dias(dias):
    m = {'LU':'Lunes','MA':'Martes','MI':'Miércoles','JU':'Jueves','VI':'Viernes','SA':'Sábado'}
    return ", ".join(m.get(d, d) for d in dias)

def calcular_probabilidad(promedio, saturacion):
    if promedio >= 100.0: return 100.0
    z = (promedio - 81.0) / 7.5
    pct = (1.0 + math.erf(z / math.sqrt(2.0))) / 2.0 * 100.0
    p_req = ((saturacion / 100.0) ** 4) * 82.0
    try:
        prob = 1.0 / (1.0 + math.exp(-0.15 * (pct - p_req))) * 100.0
    except OverflowError:
        prob = 0.0 if pct < p_req else 99.9
    return max(0.1, min(99.9, round(prob, 2)))

def _trim_google_name(full_name):
    parts = full_name.strip().split()
    return f"{parts[0]} {parts[1]}" if len(parts) >= 2 else (parts[0] if parts else '')

def _verify_google_credential(credential):
    try:
        # urlencode evita que un valor malicioso altere la URL del request
        url = "https://oauth2.googleapis.com/tokeninfo?" + urllib.parse.urlencode({'id_token': credential})
        with urllib.request.urlopen(url, timeout=5) as r:
            payload = _json.loads(r.read().decode())
        # El token DEBE haber sido emitido para NUESTRA app (evita reusar tokens de otras apps)
        if GOOGLE_CLIENT_ID and payload.get('aud') != GOOGLE_CLIENT_ID:
            return None
        # Y el usuario debe pertenecer al dominio institucional
        if payload.get('hd') != 'alumnos.udg.mx':
            return None
        return payload
    except Exception:
        return None

def _extraer_nombre(email):
    local  = email.split('@')[0]
    partes = [p.capitalize() for p in re.sub(r'\d+', '', local).split('.') if len(p) > 1]
    if not partes:     return None
    if len(partes) >= 2: return f"{partes[0]} {partes[1][0]}."
    return partes[0]

def _send_verification_email(to_email, token, profesor_nombre):
    if not EMAIL_SENDER or not EMAIL_PASSWORD:
        print(f"[email] Not configured — verify link: {BASE_URL}/api/verify/{token}")
        return
    url  = f"{BASE_URL}/api/verify/{token}"
    msg  = MIMEMultipart('alternative')
    msg['Subject'] = 'Verifica tu reseña · ProfesUdG'
    msg['From']    = f"ProfesUdG <{EMAIL_SENDER}>"
    msg['To']      = to_email
    msg.attach(MIMEText(f"""
    <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <h2 style="color:#042C53;margin:0 0 8px">ProfesUdG</h2>
      <p style="color:#525252">Gracias por tu reseña de <strong>{profesor_nombre}</strong>.</p>
      <p style="color:#525252">Haz clic para verificar tu cuenta <code>@alumnos.udg.mx</code>:</p>
      <a href="{url}" style="display:inline-block;background:#185FA5;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
        Verificar reseña ✓
      </a>
      <p style="color:#a3a3a3;font-size:12px;margin-top:24px">
        El enlace expira en 24 h. Si no enviaste esta reseña, ignora este correo.
      </p>
    </div>""", 'html'))
    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as s:
            s.login(EMAIL_SENDER, EMAIL_PASSWORD)
            s.sendmail(EMAIL_SENDER, to_email, msg.as_string())
        print(f"[email] Sent to {to_email}")
    except Exception as e:
        print(f"[email] Error: {e}")

# Historical Data Loading

def cargar_historicos(centro):
    if centro in _cache_historicos:
        return _cache_historicos[centro]

    archivos = glob.glob(os.path.join(DATA_DIR, f"{centro}_*.csv"))
    if not archivos:
        _cache_historicos[centro] = pd.DataFrame(columns=["Profesor", "Clave", "Saturacion_%"])
        return _cache_historicos[centro]

    lista_df = []
    for f in archivos:
        m = re.search(r'{}_(\d+)\.csv'.format(centro), f)
        if not m: continue
        try:
            df = pd.read_csv(f)
            if "Profesor" in df.columns and "Saturacion_%" in df.columns:
                df = df[["Profesor", "Clave", "Saturacion_%"]].copy()
                df["Ciclo"] = int(m.group(1))
                lista_df.append(df)
        except Exception:
            continue

    if not lista_df:
        _cache_historicos[centro] = pd.DataFrame(columns=["Profesor", "Clave", "Saturacion_%"])
        return _cache_historicos[centro]

    df_all = pd.concat(lista_df, ignore_index=True).sort_values(["Profesor", "Clave", "Ciclo"])

    def proyectar(g):
        if len(g) == 1: return g["Saturacion_%"].iloc[0]
        vals = g["Saturacion_%"].values
        ema  = g["Saturacion_%"].ewm(span=3, adjust=False).mean().iloc[-1]
        tend = vals[-1] - vals[-2]
        if len(vals) > 2:
            tend_prev = vals[-2] - vals[-3]
            if (tend > 0) == (tend_prev > 0): tend *= 1.2
        return max(0.0, min(99.5, ema + tend * 0.3))

    df_proj = df_all.groupby(["Profesor", "Clave"], group_keys=False).apply(
        lambda g: pd.Series({"Saturacion_%": proyectar(g)})
    ).reset_index()
    _cache_historicos[centro] = df_proj
    return df_proj

def cargar_oferta_actual(df_historico, centro):
    if centro in _cache_oferta:
        return _cache_oferta[centro]
    archivo = os.path.join(DATA_DIR, f"Oferta_Actual_{centro}.csv")
    if not os.path.exists(archivo): return []
    oferta_cruda = pd.read_csv(archivo, encoding='utf-8').to_dict('records')

    # Build O(1) saturation lookup instead of scanning the DataFrame per section
    if not df_historico.empty:
        sat_dict = df_historico.set_index(['Profesor', 'Clave'])['Saturacion_%'].to_dict()
    else:
        sat_dict = {}

    oferta = []
    for item in oferta_cruda:
        dias = []
        txt  = str(item["Dias"]).ljust(6, '.')
        if txt[0] == 'L':                dias.append('LU')
        if txt[1] == 'M':                dias.append('MA')
        if txt[2] in ('M', 'I'):         dias.append('MI')
        if txt[3] == 'J':                dias.append('JU')
        if txt[4] == 'V':                dias.append('VI')
        if len(txt) > 5 and txt[5]=='S': dias.append('SA')
        try:
            inicio, fin = map(int, str(item["Horas"]).split("-"))
        except Exception:
            continue
        prof = re.sub(r'^\d+\s*', '', str(item["Profesor"]).replace('\n', ' ')).strip()
        sat  = sat_dict.get((prof, str(item["Clave"])), 50.0)
        oferta.append({
            "NRC": str(item["NRC"]), "Clave": str(item["Clave"]),
            "Materia": str(item["Materia"]), "Profesor": prof,
            "Dias": dias, "Inicio": inicio, "Fin": fin,
            "Saturacion_%": round(sat, 2),
            "_dias_set": frozenset(dias),   # precomputed for fast overlap check
        })
    _cache_oferta[centro] = oferta
    return oferta

# Optimizer Engine

MAX_SECCIONES = 25   # sections kept per subject after sorting (caps search space)
MAX_COMBOS    = 1500 # combination limit (first combos are best due to pre-sorting)

def generar_horarios_validos(opciones):
    def chocan(c1, c2):
        # Fast path: if no shared days there can't be a time conflict
        if not (c1['_dias_set'] & c2['_dias_set']):
            return False
        return max(c1['Inicio'], c2['Inicio']) < min(c1['Fin'], c2['Fin'])
    def backtrack(idx, actual):
        if idx == len(opciones):
            yield tuple(actual); return
        for clase in opciones[idx]:
            if not any(chocan(clase, c) for c in actual):
                actual.append(clase); yield from backtrack(idx+1, actual); actual.pop()
    yield from backtrack(0, [])

def evaluar_horario(combo, turno, estrategia, promedio=85.0):
    costo = 0
    dias  = {d:[] for d in ('LU','MA','MI','JU','VI','SA')}
    for clase in combo:
        if clase['Inicio'] > 0:
            if turno=="Matutino"    and clase['Inicio']>=1400: costo+=300
            elif turno=="Vespertino" and clase['Inicio']<1400:  costo+=300
        if estrategia=="Con los mejores profesores":
            costo -= clase['Saturacion_%']*10
        elif estrategia=="Seguro por promedio":
            prob = calcular_probabilidad(promedio, clase['Saturacion_%'])
            costo -= prob*10
            if prob<10.0: costo+=2000
        for d in clase['Dias']: dias[d].append((clase['Inicio'],clase['Fin']))
    if estrategia=="Día libre":
        costo -= (6-sum(1 for v in dias.values() if v))*1000
    for clases_dia in dias.values():
        if not clases_dia: continue
        clases_dia.sort()
        for i in range(len(clases_dia)-1):
            if clases_dia[i+1][0] < clases_dia[i][1]: return 9999
            hueco=(clases_dia[i+1][0]-clases_dia[i][1])//100
            if hueco>0:
                if estrategia=="Menos horas libres": costo+=hueco*200
                elif estrategia in ("Seguro por promedio","Día libre"):
                    costo+= hueco*50 if hueco>1 else hueco*10
    return costo

def enrich_clase(c, promedio):
    por_asignar = c['Inicio'] == 0
    out = {k: v for k, v in c.items() if not k.startswith('_')}
    out["Dias_texto"]   = "Por Asignar" if por_asignar else formatear_dias(c['Dias'])
    out["Inicio_texto"] = "-" if por_asignar else formatear_hora(c['Inicio'])
    out["Fin_texto"]    = "-" if por_asignar else formatear_hora(c['Fin'])
    out["Probabilidad"] = calcular_probabilidad(promedio, c['Saturacion_%'])
    out["Por_Asignar"]  = por_asignar
    return out

# Professor Scoring

_profes_list = []

def _calcular_score(avg_sat, num_materias):
    # Softer power curve (0.8) so moderate-sat professors aren't punished harshly.
    # experiencia capped at 30 so score stays ≤ 100.
    demanda     = (min(avg_sat, 100) / 100) ** 0.8 * 70
    experiencia = min((math.log(num_materias + 1) / math.log(16)) * 30, 30)
    return round(min(demanda + experiencia, 100), 1)

def _load_profes():
    global _profes_list
    archivos = glob.glob(os.path.join(PROFES_DIR, "Profesores_*.csv"))
    if not archivos:
        print(f"[warn] No professor CSVs in {PROFES_DIR}"); return

    date_re  = re.compile(r'^\d{2}/\d{2}/\d{2}')
    all_rows = []

    for f in archivos:
        cu = os.path.basename(f).replace("Profesores_","").replace(".csv","")
        try:
            df = pd.read_csv(f)
            df = df[~df["Profesor"].astype(str).str.match(date_re)]
            df = df[df["Profesor"].notna() & (df["Profesor"].astype(str).str.strip()!="")]
            for _, row in df.iterrows():
                nombre = str(row["Profesor"]).strip()
                def parse_col(val):
                    if pd.isna(val): return []
                    return [re.sub(r'\s*\(\)','',x).strip()
                            for x in str(val).split(",") if re.sub(r'\s*\(\)','',x).strip()]
                materias = parse_col(row.get("Materia"))
                claves   = parse_col(row.get("Clave"))
                nrcs     = parse_col(row.get("NRC"))
                partes   = nombre.replace(",","").split()
                iniciales = "".join(p[0] for p in partes[:2]).upper() if partes else "??"
                all_rows.append({"nombre":nombre,"cu":cu,"materias":materias,
                                  "claves":claves,"nrcs":nrcs,"iniciales":iniciales,
                                  "num_materias":len(materias),"num_secciones":len(nrcs),
                                  "avg_sat":50.0,"score":0.0,"rating":1.0,
                                  "alta_demanda":False,"has_history":False})
        except Exception as e:
            print(f"Error loading {f}: {e}")

    # Cycle-weighted avg_sat: each (Profesor, Clave, Ciclo) record has equal weight.
    # Courses taught every semester naturally outweigh one-off niche courses.
    print("[ok] Computing cycle-weighted scores...")
    unique_centros = list(set(r["cu"] for r in all_rows))
    sat_lookup = {}
    for centro in unique_centros:
        archivos_hist = glob.glob(os.path.join(DATA_DIR, f"{centro}_*.csv"))
        dfs = []
        for f in archivos_hist:
            try:
                df = pd.read_csv(f)
                if "Profesor" in df.columns and "Saturacion_%" in df.columns:
                    dfs.append(df[["Profesor","Saturacion_%"]])
            except Exception:
                continue
        if dfs:
            df_raw = pd.concat(dfs, ignore_index=True)
            df_raw["Saturacion_%"] = df_raw["Saturacion_%"].clip(upper=100)
            sat_lookup[centro] = df_raw.groupby("Profesor")["Saturacion_%"].mean().to_dict()

    for p in all_rows:
        hist    = sat_lookup.get(p["cu"], {})
        avg_sat = hist.get(p["nombre"])
        if avg_sat is not None:
            p["has_history"]  = True
            p["avg_sat"]      = round(float(avg_sat), 1)
            p["alta_demanda"] = float(avg_sat) >= 85.0
        p["score"]  = _calcular_score(p["avg_sat"], p["num_materias"])
        p["rating"] = round(min(1.0 + (p["score"] / 100.0) * 4.0, 5.0), 1)

    all_rows.sort(key=lambda x: x["nombre"])
    _profes_list = all_rows
    print(f"[ok] {len(_profes_list)} profesores puntuados de {len(archivos)} archivos")

_load_profes()

# Blended Rating (algoritmo + reseñas reales)
#
# Promedio bayesiano: el score algorítmico actúa como "opinión previa" que las
# reseñas reales van diluyendo conforme llegan. Verificadas pesan 2×.
#
#   nota = (C × prior  +  Σ(peso_i × rating_i)) / (C + Σ peso_i)
#
# C ≈ 4 → con pocas reseñas (~5-15) las reales ya dominan; 1 sola casi no mueve.

BAYES_C = 4.0
_review_agg_cache = {'data': None, 'ts': 0.0}
_REVIEW_CACHE_TTL = 30  # segundos

def _invalidate_review_cache():
    _review_agg_cache['data'] = None

def _review_aggregates():
    import time
    now = time.time()
    if _review_agg_cache['data'] is not None and (now - _review_agg_cache['ts']) < _REVIEW_CACHE_TTL:
        return _review_agg_cache['data']
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute('''
        SELECT profesor_nombre, cu,
               SUM(CASE WHEN verificada THEN 2 ELSE 1 END)                  AS wsum,
               SUM((CASE WHEN verificada THEN 2 ELSE 1 END) * rating_general) AS wrating,
               COUNT(*)                                                     AS n,
               SUM(verificada)                                              AS nverif
        FROM reviews
        WHERE censored = 0
        GROUP BY profesor_nombre, cu
    ''').fetchall()
    conn.close()
    agg = {}
    for nombre, cu, wsum, wrating, n, nverif in rows:
        agg[(nombre, cu)] = {'wsum': wsum or 0, 'wrating': wrating or 0.0,
                             'n': n or 0, 'nverif': nverif or 0}
    _review_agg_cache['data'] = agg
    _review_agg_cache['ts']   = now
    return agg

def _blended_rating(score_algo, entry):
    """Devuelve (nota_combinada 1-5 sin redondear, num_reviews, num_verificadas)."""
    prior = 1.0 + score_algo / 100.0 * 4.0   # mapea score 0-100 → rating 1-5 (precisión fina)
    if not entry:
        return prior, 0, 0
    blended = (BAYES_C * prior + entry['wrating']) / (BAYES_C + entry['wsum'])
    return blended, entry['n'], entry['nverif']

def _with_blend(p, agg):
    """Copia el dict del profesor con la nota combinada y conteo de reseñas."""
    blended, n, nverif = _blended_rating(p['score'], agg.get((p['nombre'], p['cu'])))
    q = dict(p)
    q['rating_algoritmo'] = p['rating']        # nota original solo-algoritmo
    q['rating']           = round(blended, 1)  # nota combinada (lo que se muestra)
    q['num_reviews']      = n
    q['num_verificadas']  = nverif
    q['_blend']           = blended            # sin redondear, para ordenar
    return q

# Routes: HTML Pages

@app.route('/')
def index():
    return send_from_directory(FRONTEND_DIR, 'index.html')

@app.route('/construir-horario')
def construir_horario_page():
    return send_from_directory(FRONTEND_DIR, 'construir-horario.html')

@app.route('/robots.txt')
def robots_txt():
    return send_from_directory(FRONTEND_DIR, 'robots.txt')

@app.route('/favicon.svg')
@app.route('/favicon.ico')
def favicon():
    return send_from_directory(FRONTEND_DIR, 'favicon.svg'), 200, {'Content-Type': 'image/svg+xml'}

@app.route('/sitemap.xml')
def sitemap_xml():
    return send_from_directory(FRONTEND_DIR, 'sitemap.xml'), 200, {'Content-Type': 'application/xml'}

@app.route('/api/crear-cargo-stripe', methods=['POST'])
def crear_cargo_stripe():
    data = request.json or {}
    payment_method_id = data.get('paymentMethodId')
    try:
        amount_mxn = float(data.get('amount', 20))
    except (ValueError, TypeError):
        amount_mxn = 20.0
    amount_mxn = max(10.0, min(10000.0, amount_mxn))
    stripe_sk = os.environ.get('STRIPE_SECRET_KEY', '')

    if not payment_method_id:
        return jsonify({'error': 'Falta paymentMethodId'}), 400

    try:
        url = "https://api.stripe.com/v1/payment_intents"
        params = urllib.parse.urlencode({
            'amount': int(round(amount_mxn * 100)),
            'currency': 'mxn',
            'payment_method': payment_method_id,
            'confirm': 'true',
            'description': 'Donación ProfesUdG vía Google Pay/Apple Pay',
            'automatic_payment_methods[enabled]': 'true',
            'automatic_payment_methods[allow_redirects]': 'never'
        }).encode('utf-8')

        req = urllib.request.Request(url, data=params, headers={
            'Authorization': f'Bearer {stripe_sk}',
            'Content-Type': 'application/x-www-form-urlencoded'
        })
        with urllib.request.urlopen(req) as resp:
            res_data = _json.loads(resp.read().decode('utf-8'))
            if res_data.get('status') in ('succeeded', 'requires_capture'):
                return jsonify({'success': True, 'id': res_data.get('id')})
            return jsonify({'error': f"Estado de pago: {res_data.get('status')}"}), 400
    except Exception as e:
        err_msg = str(e)
        if hasattr(e, 'read'):
            try:
                err_msg = e.read().decode('utf-8')
            except:
                pass
        print(f"[Stripe Charge Warning/Error]: {err_msg}", flush=True)
        return jsonify({'success': False, 'error': err_msg}), 400

# Routes: API

@app.route('/api/centros')
def get_centros():
    return jsonify(list(centros.keys()))

@app.route('/api/profesores')
def get_profesores():
    q     = request.args.get('q','').strip().lower()[:100]   # acota la longitud de búsqueda
    cu    = request.args.get('cu','all')
    limit = _safe_int(request.args.get('limit', 20), 20, 1, 100)
    results = []
    tokens = q.split() if q else []
    for p in _profes_list:
        if cu!='all' and p['cu']!=cu: continue
        if tokens:
            nombre_lower = p['nombre'].lower()
            # All query tokens must appear in the name (any order → handles "oscar alvarez" vs "ALVAREZ, OSCAR")
            nombre_match  = all(tok in nombre_lower for tok in tokens)
            materia_match = any(all(tok in m.lower() for tok in tokens) for m in p['materias'])
            clave_match   = any(q in c.lower() for c in p['claves'])
            nrc_match     = q in ' '.join(p['nrcs'])
            if not (nombre_match or materia_match or clave_match or nrc_match):
                continue
        results.append(p)
    agg = _review_aggregates()
    data = []
    for p in results[:limit]:
        q = _with_blend(p, agg)
        q.pop('_blend', None)
        data.append(q)
    return jsonify({'total':len(results),'data':data})

@app.route('/api/stats')
def get_stats():
    return jsonify({'profesores':len(_profes_list),
                    'centros':len(set(p['cu'] for p in _profes_list)),
                    'materias':11861,'secciones':62959})

@app.route('/api/ranking')
def get_ranking():
    cu    = request.args.get('cu','all')
    limit = _safe_int(request.args.get('limit', 10), 10, 1, 50)
    pool  = _profes_list if cu=='all' else [p for p in _profes_list if p['cu']==cu]
    agg   = _review_aggregates()
    # Ordena por nota combinada (algoritmo + reseñas reales con peso bayesiano)
    ranked = sorted(pool, key=lambda p: -_blended_rating(p['score'], agg.get((p['nombre'], p['cu'])))[0])
    out = [_with_blend(p, agg) for p in ranked[:limit]]
    for q in out: q.pop('_blend', None)
    return jsonify(out)

# Routes: Reviews

@app.route('/api/reviews/<cu>/<path:nombre>')
def get_reviews(cu, nombre):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute('''
        SELECT id, ciclo, materia, rating_general, rating_claridad, rating_dificultad,
               recomienda, calificacion, texto, verificada, nombre_mostrado, foto_url, created_at
        FROM reviews WHERE profesor_nombre=? AND cu=? AND censored = 0
        ORDER BY verificada DESC, created_at DESC
        LIMIT 300
    ''', (nombre, cu)).fetchall()
    conn.close()
    reviews = [dict(r) for r in rows]
    if not reviews:
        return jsonify({'reviews':[],'num_reviews':0,'num_verificadas':0,
                        'avg_rating':None,'pct_recomienda':None,'avg_calificacion':None})
    # Weighted avg rating: verified reviews count 2×
    total_weight   = sum(2 if r['verificada'] else 1 for r in reviews)
    weighted_sum   = sum(r['rating_general'] * (2 if r['verificada'] else 1) for r in reviews)
    avg_rating     = weighted_sum / total_weight
    pct_recomienda = sum(1 for r in reviews if r['recomienda']) / len(reviews) * 100
    # Average calificacion (only from reviews that provided one)
    califs = [r['calificacion'] for r in reviews if r['calificacion'] is not None]
    avg_calificacion = round(sum(califs) / len(califs), 1) if califs else None
    return jsonify({'reviews':reviews,
                    'num_reviews':len(reviews),
                    'num_verificadas':sum(1 for r in reviews if r['verificada']),
                    'avg_rating':round(avg_rating,1),
                    'pct_recomienda':round(pct_recomienda),
                    'avg_calificacion':avg_calificacion})

@app.route('/api/reviews', methods=['POST'])
@limiter.limit("10 per minute")
def post_review():
    data   = request.json or {}
    nombre = data.get('profesor_nombre','').strip()
    cu     = data.get('cu','').strip()
    if not nombre or not cu:
        return jsonify({'error':'Datos incompletos'}), 400
    try:
        rating = float(data.get('rating_general', 0))
    except (ValueError, TypeError):
        rating = 0
    if not (1 <= rating <= 5):
        return jsonify({'error':'Rating inválido (1–5)'}), 400

    mostrar = bool(data.get('mostrar_nombre', False))

    # Google OAuth verification path
    google_credential = data.get('google_credential', '').strip()
    google_verified   = False
    g_name            = None
    google_email      = ''

    if google_credential:
        gp = _verify_google_credential(google_credential)
        if gp:
            google_verified = True
            google_email    = gp.get('email', '').lower()
            g_name          = gp.get('name') if mostrar else None

    # Session-based OAuth (Authorization Code flow) takes priority if no id_token
    if not google_verified and session.get('google_verified'):
        google_verified = True
        google_email    = session.get('google_email', '')
        g_name          = session.get('google_name') if mostrar else None

    # Email (Google takes priority over manual entry)
    form_email = data.get('email', '').strip().lower()
    email      = google_email or form_email

    conn = sqlite3.connect(DB_PATH)

    if email:
        email_hash = hashlib.sha256(email.encode()).hexdigest()
        dup = conn.execute(
            'SELECT id FROM reviews WHERE email_hash=? AND profesor_nombre=? AND cu=?',
            (email_hash, nombre, cu)
        ).fetchone()
        if dup:
            conn.close()
            return jsonify({'error': 'Ya enviaste una reseña para este profesor con esta cuenta de correo'}), 409
    else:
        email_hash = None
        # Anti-spam anónimo: máx 1 reseña anónima por IP al mismo profesor cada 5 minutos
        if not _throttle_ok(f'anon_rev:{_client_ip()}:{nombre}:{cu}', 1, 300):
            conn.close()
            return jsonify({'error': 'Ya enviaste una reseña para este profesor recientemente'}), 429

    verificada      = 1 if google_verified else 0
    nombre_mostrado = g_name if google_verified else None
    foto_url        = _safe_google_photo(data.get('foto_url', '')) if (google_verified and mostrar) else None

    # Calificacion: optional, must be 0–10
    calificacion = None
    raw_calif = data.get('calificacion')
    if raw_calif not in (None, '', 0, '0'):
        try:
            calificacion = float(raw_calif)
            if not (0 <= calificacion <= 100):
                calificacion = None
        except (ValueError, TypeError):
            calificacion = None

    cur = conn.execute('''
        INSERT INTO reviews
          (profesor_nombre, cu, ciclo, materia, rating_general, rating_claridad,
           rating_dificultad, recomienda, calificacion, texto, email_hash, verificada, nombre_mostrado, foto_url)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ''', (nombre, cu,
          data.get('ciclo',''), data.get('materia',''),
          rating,
          data.get('rating_claridad') or None,
          data.get('rating_dificultad') or None,
          1 if data.get('recomienda') else 0,
          calificacion,
          data.get('texto','').strip()[:1000],
          email_hash, verificada, nombre_mostrado, foto_url))
    review_id = cur.lastrowid
    conn.commit(); conn.close()
    _invalidate_review_cache()   # la nueva reseña debe reflejarse en el ranking

    env_enviado = False
    if not google_verified and form_email and form_email.endswith('@alumnos.udg.mx'):
        # Anti email-bombing: máx. 3 correos de verificación por IP por hora.
        # Evita que el servidor se use como relay para spamear a terceros.
        if _throttle_ok('email:' + _client_ip(), 3, 3600):
            nombre_extraido = _extraer_nombre(form_email) if mostrar else None
            token = serializer.dumps({'review_id': review_id, 'nombre': nombre_extraido})
            _send_verification_email(form_email, token, nombre)
            env_enviado = True

    return jsonify({'success': True, 'id': review_id,
                    'verificacion_enviada': env_enviado,
                    'google_verificada': google_verified})

@app.route('/api/verify/<token>')
def verify_review(token):
    try:
        data = serializer.loads(token, max_age=86400)
    except (BadSignature, SignatureExpired):
        return redirect('/?verified=error')
    conn = sqlite3.connect(DB_PATH)
    conn.execute('UPDATE reviews SET verificada=1, nombre_mostrado=? WHERE id=?',
                 (data.get('nombre'), data['review_id']))
    conn.commit(); conn.close()
    return redirect('/?verified=1')

# Routes: Optimizer

@app.route('/api/optimizar', methods=['POST'])
@limiter.limit("15 per minute")   # operación pesada de CPU — limita para evitar DoS
def optimizar():
    data       = request.json or {}
    centro     = data.get('centro','CUCEI')
    claves_in  = data.get('claves','')
    try:
        promedio = float(data.get('promedio', 85.0))
    except (ValueError, TypeError):
        return jsonify({"error": "Promedio inválido"}), 400
    promedio   = max(0.0, min(100.0, promedio))   # acota el rango
    turno      = data.get('turno','Libre')
    estrategia = data.get('estrategia','Seguro por promedio')
    if centro not in centros:
        return jsonify({"error":"Centro no válido"}), 400
    if len(claves_in) > 500:   # evita payloads gigantes que exploten el backtracking
        return jsonify({"error":"Demasiadas claves"}), 400
    claves_crudas = [c.strip().upper() for c in claves_in.split(",") if c.strip()]
    claves        = list(dict.fromkeys(claves_crudas))
    duplicadas    = [c for c in set(claves_crudas) if claves_crudas.count(c)>1]
    df_hist = cargar_historicos(centro)
    oferta  = cargar_oferta_actual(df_hist, centro)
    if not oferta:
        return jsonify({"error":f"Sin oferta para {centro}"}), 404

    # Build O(1) lookup by Clave
    oferta_by_clave: dict = {}
    for item in oferta:
        oferta_by_clave.setdefault(item['Clave'], []).append(item)

    sort_key = (lambda c: calcular_probabilidad(promedio, c['Saturacion_%'])) \
               if estrategia == "Seguro por promedio" else (lambda c: c['Saturacion_%'])

    opciones = []
    for clave in claves:
        opts = sorted(oferta_by_clave.get(clave, []), key=sort_key, reverse=True)
        opciones.append(opts[:MAX_SECCIONES])   # cap to best N sections

    no_encontradas = [claves[i] for i, opt in enumerate(opciones) if not opt]
    if no_encontradas:
        return jsonify({"error":f"Claves no encontradas: {', '.join(no_encontradas)}"}), 404

    combinaciones = []
    for c in generar_horarios_validos(opciones):
        combinaciones.append(c)
        if len(combinaciones) >= MAX_COMBOS: break
    validos = [{'costo':evaluar_horario(c,turno,estrategia,promedio),'clases':list(c)}
               for c in combinaciones]
    validos = [v for v in validos if v['costo']<9999]
    validos.sort(key=lambda x: x['costo'])
    if not validos:
        return jsonify({"error":"No existen combinaciones sin traslape"}), 404
    top3 = [[enrich_clase(c,promedio) for c in v['clases']] for v in validos[:3]]
    clases_riesgosas = [c for c in validos[0]['clases']
                        if calcular_probabilidad(promedio,c['Saturacion_%'])<10.0]
    flex = None
    if clases_riesgosas:
        seguros = [v for v in validos if all(
            calcular_probabilidad(promedio,c['Saturacion_%'])>=10.0 for c in v['clases'])]
        if seguros:
            flex={"tipo":"alternativa_profesor","clases":[enrich_clase(c,promedio) for c in seguros[0]['clases']]}
        else:
            for sacrificar in claves:
                sub = [sorted(oferta_by_clave.get(k, []), key=sort_key, reverse=True)[:MAX_SECCIONES]
                       for k in claves if k != sacrificar]
                if not all(sub): continue
                comb_s = []
                for c in generar_horarios_validos(sub):
                    comb_s.append(c)
                    if len(comb_s) >= 800: break
                val_s = sorted(
                    [{'costo': evaluar_horario(c, turno, estrategia, promedio), 'clases': list(c)}
                     for c in comb_s if evaluar_horario(c, turno, estrategia, promedio) < 9999],
                    key=lambda x: x['costo'])
                if val_s and all(calcular_probabilidad(promedio,c['Saturacion_%'])>=10.0
                                 for c in val_s[0]['clases']):
                    mat=next((c['Materia'] for c in oferta if c['Clave']==sacrificar),sacrificar)
                    flex={"tipo":"sacrificio","materia_sacrificada":mat,
                          "clases":[enrich_clase(c,promedio) for c in val_s[0]['clases']]}
                    break
            if not flex: flex={"tipo":"sin_alternativa"}
    return jsonify({"total":len(validos),"duplicadas":duplicadas,
                    "resultados":top3,"flexibilidad":flex})

# Routes: Page Visits

@app.route('/api/visita', methods=['POST'])
@limiter.limit("60 per minute")
def post_visita():
    data = request.json or {}
    page = str(data.get('page', '/'))[:50]
    # Anti-inflado: una misma IP+página solo cuenta una vez cada 10 s.
    # Evita que se llene la tabla (y el disco) con visitas falsas.
    if not _throttle_ok(f'visit:{_client_ip()}:{page}', 1, 10):
        return jsonify({'ok': True})
    conn = sqlite3.connect(DB_PATH)
    conn.execute('INSERT INTO page_visits (page) VALUES (?)', (page,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

# Routes: Public Support

@app.route('/api/soporte', methods=['POST'])
@limiter.limit("5 per minute")
def post_soporte():
    descripcion = request.form.get('descripcion', '').strip()[:2000]
    email       = request.form.get('email', '').strip()[:120]
    if not descripcion:
        return jsonify({'error': 'Descripción requerida'}), 400

    foto_nombre = None
    if 'foto' in request.files:
        foto = request.files['foto']
        if foto and foto.filename:
            ext = os.path.splitext(foto.filename)[1].lower()
            if ext in ALLOWED_EXTS:
                foto_nombre = f"{uuid.uuid4().hex}{ext}"
                foto.save(os.path.join(UPLOADS_DIR, foto_nombre))

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('INSERT INTO support_tickets (descripcion, foto_nombre, email) VALUES (?,?,?)',
                 (descripcion, foto_nombre, email))
    ticket_id = cursor.lastrowid
    conn.commit()
    conn.close()

    # Notificar al Administrador por Correo
    dest = os.environ.get('ADMIN_EMAIL') or os.environ.get('SMTP_USER') or os.environ.get('EMAIL_SENDER')
    if dest:
        foto_info = f"<p><strong>Imagen adjunta:</strong> <a href='{request.host_url}admin/uploads/{foto_nombre}'>{foto_nombre}</a></p>" if foto_nombre else "<p><em>Sin imagen adjunta</em></p>"
        user_info = f"<a href='mailto:{email}'>{email}</a>" if email else "Anónimo (sin correo)"
        subject = f"[ProfesUdG] Nuevo Ticket de Soporte #{ticket_id}"
        html_body = f"""
        <div style="font-family:sans-serif;padding:20px;color:#262626;max-width:550px;border:1px solid #e5e5e5;border-radius:12px;">
          <h2 style="color:#185FA5;margin-top:0;">Nuevo Ticket de Soporte #{ticket_id}</h2>
          <p><strong>De:</strong> {user_info}</p>
          <p><strong>Descripción del reporte:</strong></p>
          <div style="background:#F0F7FF;padding:14px;border-left:4px solid #185FA5;border-radius:6px;font-size:14px;color:#042C53;margin-bottom:14px;">
            {descripcion}
          </div>
          {foto_info}
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
          <p style="font-size:12px;color:#737373;margin:0;">Sistema de Notificaciones ProfesUdG</p>
        </div>
        """
        send_email_async(dest, subject, html_body)

    return jsonify({'success': True})

# Routes: Google OAuth

@app.route('/api/auth/google')
def auth_google():
    if not GOOGLE_CLIENT_ID:
        return jsonify({'error': 'Google OAuth no configurado'}), 503
    params = urllib.parse.urlencode({
        'client_id':     GOOGLE_CLIENT_ID,
        'redirect_uri':  GOOGLE_REDIRECT_URI,
        'response_type': 'code',
        'scope':         'openid profile email',
        'hd':            'alumnos.udg.mx',
        'prompt':        'select_account',
    })
    return redirect(f'https://accounts.google.com/o/oauth2/v2/auth?{params}')

@app.route('/api/auth/callback')
def auth_callback():
    code = request.args.get('code')
    if not code:
        return _popup_response('error'), 200, {'Content-Type': 'text/html'}
    try:
        req = urllib.request.Request(
            'https://oauth2.googleapis.com/token',
            data=urllib.parse.urlencode({
                'code':          code,
                'client_id':     GOOGLE_CLIENT_ID,
                'client_secret': GOOGLE_CLIENT_SECRET,
                'redirect_uri':  GOOGLE_REDIRECT_URI,
                'grant_type':    'authorization_code',
            }).encode(),
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            token_resp = _json.loads(r.read().decode())
    except Exception:
        return _popup_response('error'), 200, {'Content-Type': 'text/html'}

    access_token = token_resp.get('access_token')
    if not access_token:
        return _popup_response('error'), 200, {'Content-Type': 'text/html'}

    try:
        req = urllib.request.Request(
            'https://www.googleapis.com/oauth2/v3/userinfo',
            headers={'Authorization': f'Bearer {access_token}'}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            user_info = _json.loads(r.read().decode())
    except Exception:
        return _popup_response('error'), 200, {'Content-Type': 'text/html'}

    email = user_info.get('email', '').lower()
    hd    = user_info.get('hd', '')
    if hd != 'alumnos.udg.mx' and not email.endswith('@alumnos.udg.mx'):
        return _popup_response('denied'), 200, {'Content-Type': 'text/html'}

    session['google_verified'] = True
    session['google_email']    = email
    session['google_name']     = _trim_google_name(user_info.get('name', ''))
    session['google_picture']  = user_info.get('picture', '')
    return _popup_response('ok'), 200, {'Content-Type': 'text/html'}

@app.route('/api/auth/me')
def auth_me():
    if session.get('google_verified'):
        return jsonify({
            'verified': True,
            'email':    session.get('google_email', ''),
            'name':     session.get('google_name', ''),
            'picture':  session.get('google_picture', ''),
        })
    return jsonify({'verified': False})

@app.route('/api/auth/logout', methods=['POST'])
def auth_logout_google():
    session.pop('google_verified', None)
    session.pop('google_email', None)
    session.pop('google_name', None)
    session.pop('google_picture', None)
    return jsonify({'ok': True})

# Admin Authentication

def requires_admin(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('admin_logged_in'):
            return redirect('/admin/login')
        return f(*args, **kwargs)
    return decorated

@app.route('/admin/login', methods=['GET', 'POST'])
@limiter.limit("10 per minute", methods=['POST'])   # frena ataques de fuerza bruta
def admin_login():
    error = None
    if request.method == 'POST':
        # compare_digest evita timing attacks (no revela cuántos caracteres acertó)
        user_ok = hmac.compare_digest(request.form.get('usuario', ''), ADMIN_USER)
        pass_ok = hmac.compare_digest(request.form.get('password', ''), ADMIN_PASS)
        if user_ok and pass_ok:
            session['admin_logged_in'] = True
            session.permanent = False
            return redirect('/admin')
        error = 'Usuario o contraseña incorrectos.'
    return render_template('admin_login.html', error=error)

@app.route('/admin/logout')
def admin_logout():
    session.clear()
    return redirect('/admin/login')

@app.route('/admin')
@app.route('/admin/')
@requires_admin
def admin_index():
    return render_template('admin.html')

@app.route('/admin/uploads/<path:filename>')
@requires_admin
def admin_upload(filename):
    return send_from_directory(UPLOADS_DIR, filename)

# Admin API

@app.route('/admin/api/stats')
@requires_admin
def admin_stats():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    r = conn.execute('''
        SELECT
            COUNT(*) as total,
            SUM(verificada) as verificadas,
            SUM(censored)   as censuradas
        FROM reviews
    ''').fetchone()
    tickets = conn.execute("SELECT COUNT(*) FROM support_tickets WHERE estado='pendiente'").fetchone()[0]
    conn.close()
    return jsonify({
        'total_reviews':   r['total'] or 0,
        'verificadas':     r['verificadas'] or 0,
        'censuradas':      r['censuradas'] or 0,
        'tickets_pending': tickets
    })

@app.route('/admin/api/visitas')
@requires_admin
def admin_visitas():
    import datetime
    conn = sqlite3.connect(DB_PATH)

    hoy    = conn.execute("SELECT COUNT(*) FROM page_visits WHERE date(created_at)=date('now','localtime')").fetchone()[0]
    semana = conn.execute("SELECT COUNT(*) FROM page_visits WHERE created_at>=datetime('now','localtime','-7 days')").fetchone()[0]
    mes    = conn.execute("SELECT COUNT(*) FROM page_visits WHERE strftime('%Y-%m',created_at)=strftime('%Y-%m',datetime('now','localtime'))").fetchone()[0]
    total  = conn.execute("SELECT COUNT(*) FROM page_visits").fetchone()[0]

    now = datetime.datetime.now()
    if 2 <= now.month <= 7:
        ciclo_start = f"{now.year}-02-01"
        ciclo_label = f"{now.year}A"
    elif now.month >= 8:
        ciclo_start = f"{now.year}-08-01"
        ciclo_label = f"{now.year}B"
    else:
        ciclo_start = f"{now.year-1}-08-01"
        ciclo_label = f"{now.year-1}B"

    ciclo = conn.execute("SELECT COUNT(*) FROM page_visits WHERE date(created_at)>=?", (ciclo_start,)).fetchone()[0]

    por_dia = conn.execute(
        "SELECT date(created_at,'localtime') as dia, page, COUNT(*) as cnt "
        "FROM page_visits WHERE created_at>=datetime('now','localtime','-30 days') "
        "GROUP BY dia, page ORDER BY dia DESC"
    ).fetchall()

    conn.close()

    # Aggregate per day across pages
    from collections import defaultdict
    dias: dict = defaultdict(lambda: {'index': 0, 'horario': 0, 'otro': 0})
    for row in por_dia:
        dia, page, cnt = row
        key = page if page in ('index', 'horario') else 'otro'
        dias[dia][key] += cnt

    dias_list = [{'dia': d, **v} for d, v in sorted(dias.items(), reverse=True)]

    return jsonify({
        'hoy': hoy, 'semana': semana, 'mes': mes, 'ciclo': ciclo,
        'ciclo_label': ciclo_label, 'total': total,
        'por_dia': dias_list
    })

@app.route('/admin/api/reviews')
@requires_admin
def admin_reviews():
    page    = _safe_int(request.args.get('page', 1), 1, 1, 100000)
    limit   = 20
    offset  = (page - 1) * limit
    cu      = request.args.get('cu', 'all')
    q       = request.args.get('q', '').strip().lower()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    where, params = [], []
    if cu != 'all':
        where.append('cu = ?'); params.append(cu)
    if q:
        where.append("(LOWER(profesor_nombre) LIKE ? OR LOWER(texto) LIKE ?)")
        params += [f'%{q}%', f'%{q}%']
    clause = ('WHERE ' + ' AND '.join(where)) if where else ''

    total = conn.execute(f'SELECT COUNT(*) FROM reviews {clause}', params).fetchone()[0]
    rows  = conn.execute(
        f'SELECT id, profesor_nombre, cu, ciclo, materia, rating_general, calificacion, '
        f'texto, verificada, censored, nombre_mostrado, created_at '
        f'FROM reviews {clause} ORDER BY created_at DESC LIMIT ? OFFSET ?',
        params + [limit, offset]
    ).fetchall()
    conn.close()
    return jsonify({'total': total, 'page': page, 'pages': max(1, -(-total // limit)),
                    'reviews': [dict(r) for r in rows]})

@app.route('/admin/api/reviews/<int:rid>/edit', methods=['POST'])
@requires_admin
def admin_edit_review(rid):
    data  = request.json or {}
    texto = data.get('texto', '').strip()[:1000]
    censored = 1 if data.get('censored') else 0
    conn = sqlite3.connect(DB_PATH)
    conn.execute('UPDATE reviews SET texto=?, censored=? WHERE id=?', (texto, censored, rid))
    conn.commit()
    conn.close()
    _invalidate_review_cache()   # censurar cambia qué reseñas cuentan para el ranking
    return jsonify({'success': True})

@app.route('/admin/api/reviews/<int:rid>/delete', methods=['POST'])
@requires_admin
def admin_delete_review(rid):
    conn = sqlite3.connect(DB_PATH)
    conn.execute('DELETE FROM reviews WHERE id=?', (rid,))
    conn.commit()
    conn.close()
    _invalidate_review_cache()
    return jsonify({'success': True})

@app.route('/admin/api/tickets')
@requires_admin
def admin_tickets():
    estado = request.args.get('estado', 'all')
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    if estado == 'all':
        rows = conn.execute('SELECT * FROM support_tickets ORDER BY created_at DESC').fetchall()
    else:
        rows = conn.execute('SELECT * FROM support_tickets WHERE estado=? ORDER BY created_at DESC',
                            (estado,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/admin/api/tickets/<int:tid>/resolve', methods=['POST'])
@requires_admin
def admin_resolve_ticket(tid):
    data = request.json or {}
    nota_resolucion = data.get('nota_resolucion', '').strip()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    ticket = conn.execute("SELECT * FROM support_tickets WHERE id=?", (tid,)).fetchone()
    if not ticket:
        conn.close()
        return jsonify({'error': 'Ticket no encontrado'}), 404

    conn.execute("UPDATE support_tickets SET estado='resuelto', nota_resolucion=? WHERE id=?", (nota_resolucion, tid))
    conn.commit()
    conn.close()

    # Notificar al Usuario si proporcionó su correo al crear el ticket
    user_email = ticket['email'] if dict(ticket).get('email') else None
    if user_email and '@' in user_email:
        subject = f"Tu ticket de soporte #{tid} ha sido resuelto - ProfesUdG"
        
        nota_html = f"""
        <div style="background:#FFFBEB;padding:14px;border-left:4px solid #D97706;border-radius:6px;font-size:14px;color:#92400E;margin:14px 0;">
          <strong>Comentario de resolución del equipo:</strong><br>
          {nota_resolucion}
        </div>
        """ if nota_resolucion else ""

        html_body = f"""
        <div style="font-family:sans-serif;padding:24px;color:#262626;max-width:550px;border:1px solid #e5e5e5;border-radius:12px;">
          <h2 style="color:#0F6E56;margin-top:0;">¡Tu reporte ha sido resuelto!</h2>
          <p>Hola,</p>
          <p>Te informamos que tu reporte en <strong>ProfesUdG</strong> con la siguiente descripción:</p>
          <blockquote style="background:#E6F4F1;padding:14px;border-left:4px solid #0F6E56;border-radius:6px;color:#0F6E56;margin:14px 0;white-space:pre-wrap;">
            "{ticket['descripcion']}"
          </blockquote>
          {nota_html}
          <p>Ha sido revisado y <strong>resuelto con éxito</strong> por nuestro equipo de administración.</p>
          <p>¡Muchas gracias por ayudarnos a mantener ProfesUdG al 100%!</p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
          <p style="font-size:12px;color:#737373;margin:0;">Atentamente,<br><strong>Equipo ProfesUdG</strong></p>
        </div>
        """
        send_email_async(user_email, subject, html_body)

    return jsonify({'success': True})

# Main Entry Point

if __name__ == '__main__':
    print("Servidor en http://localhost:5001")
    print(f"Admin panel: http://localhost:5001/admin  (usuario: {ADMIN_USER})")
    app.run(debug=False, port=5001)
