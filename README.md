# ProfesUdG

Plataforma estudiantil independiente para la Universidad de Guadalajara. Permite
buscar profesores con datos históricos reales, leer y dejar reseñas verificadas,
y generar horarios óptimos sin conflictos usando saturación histórica de SIIAU.

> Hecho por Ezequiel Delgadillo, para estudiantes. Sin patrocinio institucional ni fines de lucro.

---

## Stack

| Capa | Tecnología |
|---|---|
| Backend + servidor | Python · Flask |
| Datos | Pandas · SQLite |
| Frontend | HTML · CSS · JS vanilla |
| Autenticación | Google OAuth 2.0 (Authorization Code flow) |
| Verificación de reseñas | Google OAuth · Email token (itsdangerous) |

---

## Instalación

```bash
# 1. Clonar el repo
git clone https://github.com/EzequielDH/ProfesUdG.git
cd ProfesUdG

# 2. Crear entorno virtual
python -m venv env
.\env\Scripts\Activate.ps1        # Windows
# source env/bin/activate          # Mac/Linux

# 3. Instalar dependencias
pip install flask pandas itsdangerous

# 4. Configurar variables de entorno 

# 5. Agregar los archivos de datos (ver backend/data/README.md)

# 6. Correr el servidor
python backend/api.py
```

Abre `http://localhost:5001`.

---

## Variables de entorno

| Variable | Descripción | Requerida |
|---|---|---|
| `ID-client` | Google OAuth Client ID | Para verificación Google |
| `Secret-client` | Google OAuth Client Secret | Para verificación Google |
| `GOOGLE_REDIRECT_URI` | URI de callback OAuth | No (default: `http://localhost:5001/api/auth/callback`) |
| `SECRET_KEY` | Clave para firmar tokens de email | Recomendada en producción |
| `EMAIL_SENDER` | Correo Gmail para enviar verificaciones | Para verificación por email |
| `EMAIL_PASSWORD` | Contraseña de aplicación Gmail | Para verificación por email |
| `BASE_URL` | URL pública del servidor | En producción |
| `user_admin` | Usuario del panel admin | Sí |
| `pass_admin` | Contraseña del panel admin | Sí |

---

## Algoritmos y fórmulas

### 1. Score de profesor

Cada profesor recibe un score de 0 a 100 al iniciar el servidor, calculado
a partir de su **demanda histórica** (saturación promedio) y su **experiencia**
(número de materias distintas que imparte).

```
demanda     = (avg_sat / 100) ^ 0.8  ×  70
experiencia = min( log(materias + 1) / log(16)  ×  30,  30 )

score = min(demanda + experiencia, 100)
```

- **`avg_sat`**: promedio ponderado por ciclo de la saturación del profesor en
  todos los ciclos históricos disponibles. Se clampea a 100 antes de usarse.
- La curva de potencia `^0.8` (en lugar de lineal) evita penalizar duramente
  a profesores con demanda moderada (60–80 %).
- La experiencia usa `log` base 16 para que un profesor con 15+ materias llegue
  al tope de 30 puntos, pero uno con 1 materia solo sume ~7 puntos.
- Profesores **sin historial** reciben `avg_sat = 50` (neutral).

### 2. Rating (estrellas)

El rating de 1 a 5 estrellas que se muestra en la UI se deriva directamente
del score:

```
rating = min(1 + (score / 100) × 4,  5.0)
```

Un score de 0 → 1 estrella. Score de 100 → 5 estrellas. Escala lineal entre ambos.

### 3. Proyección de saturación

Para el constructor de horarios se necesita **predecir** la saturación que
tendrá una sección en el ciclo actual, no solo el promedio histórico.

Por cada par `(Profesor, Clave)` se aplica:

```
EMA₃  = media móvil exponencial con span=3 sobre los ciclos ordenados
tend  = sat[último] − sat[penúltimo]

si la tendencia es consistente (misma dirección los últimos 2 pasos):
    tend × 1.2   (se amplifica un 20 %)

saturación_proyectada = clamp(EMA₃ + tend × 0.3,  0,  99.5)
```

- La **EMA** da más peso a los ciclos recientes que al promedio simple.
- La **tendencia** ajusta si el profesor está ganando o perdiendo popularidad.
- El factor `0.3` modera el ajuste para no sobreproyectar.
- Si el profesor solo tiene 1 ciclo de historial, se usa ese valor directamente.

### 4. Probabilidad de inscripción

Dado el promedio del estudiante y la saturación proyectada de una sección,
calcula la probabilidad de que el estudiante logre inscribirse.

```
z    = (promedio − 81.0) / 7.5
pct  = Φ(z) × 100                          # CDF normal estándar × 100

p_req = (saturacion / 100) ^ 4  ×  82.0    # umbral de prioridad requerido

prob = sigmoid(0.15 × (pct − p_req)) × 100
```

Donde `Φ(z)` es la función de distribución acumulada normal (implementada
con `math.erf`) y `sigmoid(x) = 1 / (1 + e^−x)`.

- **`pct`**: percentil del estudiante en la distribución de promedios (media 81,
  desviación 7.5, basado en datos históricos de la UdG).
- **`p_req`**: exigencia de prioridad de la sección. La potencia `^4` hace que
  secciones muy saturadas (>90 %) sean exponencialmente más difíciles.
- El resultado se clampea a `[0.1, 99.9]` %.

### 5. Generador de horarios (backtracking)

El optimizador busca todas las combinaciones de secciones sin traslapes.

```
Para cada materia, ordenar secciones por estrategia (desc):
  - "Con los mejores profesores" → por Saturacion_%
  - "Seguro por promedio"        → por Probabilidad
  Tomar las mejores 25 secciones (MAX_SECCIONES)

Backtracking:
  para cada materia en orden:
    para cada sección disponible:
      si no choca con ninguna sección ya elegida → agregar y continuar
      si se llega al final → emitir combinación válida
  detener al llegar a 1500 combinaciones (MAX_COMBOS)
```

Detección de traslape (fast path):
```
chocan(A, B):
  si A.dias ∩ B.dias = ∅ → False  (no comparten día, imposible chocar)
  si max(A.inicio, B.inicio) < min(A.fin, B.fin) → True
```

### 6. Evaluador y ranker de horarios

Cada combinación válida recibe un **costo** (menor = mejor). Las primeras
3 combinaciones de menor costo se retornan al usuario.

```
costo = 0

Por cada clase en el horario:
  turno incorrecto (mat/vesp)  → +300

Por estrategia:
  "Con los mejores profesores" → −Saturacion% × 10      (premia demanda)
  "Seguro por promedio"        → −Probabilidad × 10     (premia probabilidad)
                                  si prob < 10% → +2000 (penaliza secciones casi imposibles)
  "Día libre"                  → −días_libres × 1000    (premia días sin clase)

Por huecos entre clases en el mismo día:
  hueco = (inicio_siguiente − fin_anterior) // 100  (en horas enteras)
  "Menos horas libres"         → hueco × 200
  "Seguro" / "Día libre"       → hueco × 50  (si hueco > 1h),  hueco × 10 (si ≤ 1h)

Traslape detectado             → costo = 9999 (descartado)
```

---

## Estructura del proyecto

```
ProfesUdG/
├── backend/
│   ├── api.py              # Servidor Flask + toda la lógica
│   ├── templates/
│   │   ├── admin.html      # Panel de administración
│   │   └── admin_login.html
│   ├── data/               # CSVs de datos (no incluidos, ver data/README.md)
│   └── uploads/            # Imágenes de tickets de soporte (no incluidas)
├── frontend/
│   ├── index.html          # Página principal
│   ├── construir-horario.html
│   ├── css/
│   └── js/
│       ├── main.js         # Lógica de búsqueda, perfiles y reseñas
│       ├── horario.js      # Lógica del constructor de horarios
│       └── animations.js   # Animaciones GSAP
├── .gitignore
├── LICENSE                 # MIT
└── README.md
```

---

## Panel de administración

Disponible en `/admin`. Requiere las credenciales configuradas en
`user_admin` y `pass_admin`. Permite:

- Ver estadísticas de uso y visitas
- Moderar reseñas (editar texto, censurar, eliminar)
- Gestionar tickets de soporte

---

## Licencia

[CC BY-NC-SA 4.0](LICENSE) © 2026 Ezequiel Delgadillo

- ✓ Uso libre con atribución obligatoria
- ✗ Prohibido uso comercial o empresarial
- ↺ Los proyectos derivados deben ser open source con la misma licencia

Los datos de SIIAU usados para el motor de scoring no se incluyen en este repositorio.
