import requests
from bs4 import BeautifulSoup
import pandas as pd
import time
import os

def extraer_historial_siiau():
    url = "http://consulta.siiau.udg.mx/wco/sspseca.consulta_oferta"
    
    # Headers to mimic a real browser request
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "es-MX,es;q=0.9",
        "Cache-Control": "max-age=0",
        "Connection": "keep-alive",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "http://consulta.siiau.udg.mx",
        "Referer": "http://consulta.siiau.udg.mx/wco/sspseca.forma_consulta",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    calendarios = [
        "202620", "202610", "202680",
        "202520", "202510", "202580", 
        "202420", "202410", "202480", 
        "202320", "202310", "202380"
    ]

    centros = {
        "3": "C.U. TLAJOMULCO", "4": "C.U. GUADALAJARA", "5": "C.U. TLAQUEPAQUE", 
        "6": "C.U. CHAPALA", "A": "CUAAD", "B": "CUCBA", "C": "CUCEA", 
        "D": "CUCEI", "E": "CUCS", "F": "CUCSH", "G": "CUALTOS", 
        "H": "CUCIENEGA", "I": "CUCOSTA", "J": "CUCSUR", "K": "CUSUR", 
        "M": "CUVALLES", "N": "CUNORTE", "O": "CUCEI VALLES", 
        "P": "CUCSUR VALLES", "Q": "CUCEI NORTE", "R": "CUALTOS NORTE", 
        "S": "CUCOSTA NORTE", "T": "SEDE TLAJOMULCO", "U": "CULAGOS", 
        "W": "CUCEA VALLES", "X": "UDG VIRTUAL", "Z": "CUTONALA"
    }
    
    directorio_actual = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'profes')

    # Flag to check connection on the first attempt
    conexion_probada = False

    for id_centro, nombre_centro in centros.items():
        print(f"\nIniciando búsqueda para: {nombre_centro} ({id_centro})")
        datos_totales = []

        for ciclo in calendarios:
            print(f"  Consultando ciclo: {ciclo}")
            payload = {
                "ciclop": ciclo,
                "cup": id_centro,
                "mostrarp": "100000",
                "ordenp": "0"
            }
            
            try:
                # Use a session to maintain cookies if required by SIIAU
                session = requests.Session()
                response = session.post(url, data=payload, headers=headers, timeout=60)
                response.raise_for_status()
                
                # Verify server response (first cycle only)
                if not conexion_probada:
                    if len(response.text) < 1000:
                        print(f"¡ADVERTENCIA! La respuesta del servidor es demasiado corta. Es posible que te hayan bloqueado la IP. Longitud: {len(response.text)}")
                        return
                    print("✓ Conexión establecida correctamente con el servidor SIIAU.")
                    conexion_probada = True
                
                soup = BeautifulSoup(response.text, 'html.parser')
                
                # Find all tables in the HTML structure
                tablas_principales = soup.find_all('table')
                if not tablas_principales:
                    print(f"    Sin datos en la estructura HTML para {ciclo}.")
                    continue
                
                # Iterate over all table rows
                filas_procesadas = 0
                for fila in soup.find_all('tr'):
                    celdas = fila.find_all('td', recursive=False)
                    if not celdas:
                        celdas = fila.find_all('td')
                        
                    if len(celdas) >= 8:
                        nrc = celdas[0].text.strip()
                        
                        if nrc.isdigit():
                            filas_procesadas += 1
                            clave = celdas[1].text.strip()
                            materia = celdas[2].text.strip()
                            
                            celda_profesor = celdas[8] if len(celdas) > 8 else celdas[-1]
                            profesor = "POR ASIGNAR"
                            
                            tabla_prof = celda_profesor.find('table')
                            if tabla_prof:
                                tds_prof = tabla_prof.find_all('td')
                                if len(tds_prof) >= 2:
                                    profesor = tds_prof[-1].text.strip()
                            else:
                                texto = celda_profesor.text.strip()
                                if len(texto) > 3:
                                    profesor = texto

                            if profesor and "PROFESOR" not in profesor.upper() and profesor != "POR ASIGNAR":
                                datos_totales.append({
                                    "Profesor": profesor,
                                    "Materia": materia,
                                    "Clave": clave,
                                    "NRC": nrc
                                })
                
                print(f"    Extraídos {filas_procesadas} registros en este ciclo.")
                time.sleep(2)
                
            except requests.exceptions.RequestException as e:
                print(f"  Error de red en ciclo {ciclo}: {e}")
                continue
            except Exception as e:
                print(f"  Error al parsear ciclo {ciclo}: {e}")
                continue
        
        if datos_totales:
            df = pd.DataFrame(datos_totales)
            
            df_agrupado = df.groupby("Profesor").agg({
                "Materia": lambda x: ", ".join(dict.fromkeys(x)),
                "Clave": lambda x: ", ".join(dict.fromkeys(x)),
                "NRC": lambda x: ", ".join(dict.fromkeys(x))
            }).reset_index()
            
            nombre_archivo = f"Profesores_{nombre_centro.replace(' ', '_').replace('.', '')}"
            ruta_excel = os.path.join(directorio_actual, f"{nombre_archivo}.xlsx")
            ruta_csv = os.path.join(directorio_actual, f"{nombre_archivo}.csv")
            
            df_agrupado.to_excel(ruta_excel, index=False)
            df_agrupado.to_csv(ruta_csv, index=False, encoding='utf-8')
            print(f"-> Archivos generados: {nombre_archivo} con {len(df_agrupado)} profesores únicos.")
        else:
            print(f"-> Sin datos consolidados para {nombre_centro}. Omitiendo archivos.")

if __name__ == "__main__":
    extraer_historial_siiau()