import requests
from bs4 import BeautifulSoup
import pandas as pd
import time
import os

def generar_historial_red():
    url = "http://consulta.siiau.udg.mx/wco/sspseca.consulta_oferta"
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    
    calendarios = ["202610", "202520", "202510", "202420", "202410", "202320", "202310"]
    centros = {
        "A": "CUAAD", "B": "CUCBA", "C": "CUCEA", 
        "E": "CUCS", "F": "CUCSH", "G": "CUALTOS", 
        "H": "CUCIENEGA", "I": "CUCOSTA", "J": "CUCSUR", "K": "CUSUR", 
        "M": "CUVALLES", "N": "CUNORTE", "Z": "CUTONALA", "X": "UDG_VIRTUAL",
        "3": "CU_TLAJOMULCO", "4": "CU_GUADALAJARA", "5": "CU_TLAQUEPAQUE", "6": "CU_CHAPALA"
    }
    directorio_actual = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')

    for cup, nombre_centro in centros.items():
        print(f"\n--- Iniciando descargas para: {nombre_centro} ---")
        for ciclo in calendarios:
            print(f"Descargando ciclo {ciclo}...")
            payload = {"ciclop": ciclo, "cup": cup, "mostrarp": "100000", "ordenp": "0"}
            datos_ciclo = []
            
            try:
                response = requests.post(url, data=payload, headers=headers, timeout=60)
                soup = BeautifulSoup(response.text, 'html.parser')
                
                for fila in soup.find_all('tr'):
                    celdas = fila.find_all('td', recursive=False) or fila.find_all('td')
                        
                    if len(celdas) >= 8 and celdas[0].text.strip().isdigit():
                        clave = celdas[1].text.strip()
                        materia = celdas[2].text.strip()
                        
                        try:
                            cupo = int(celdas[5].text.strip())
                            disponibles = int(celdas[6].text.strip())
                        except ValueError:
                            continue
                        
                        celda_prof = celdas[8] if len(celdas) > 8 else celdas[-1]
                        profesor = "POR ASIGNAR"
                        
                        tabla_prof = celda_prof.find('table')
                        if tabla_prof:
                            tds = tabla_prof.find_all('td')
                            if len(tds) >= 2:
                                profesor = tds[-1].text.strip()
                        elif len(celda_prof.text.strip()) > 3:
                            profesor = celda_prof.text.strip()

                        if "PROFESOR" not in profesor.upper() and profesor != "POR ASIGNAR":
                            datos_ciclo.append({
                                "Profesor": profesor,
                                "Clave": clave,
                                "Materia": materia,
                                "Cupo_Total": cupo,
                                "Disponibles": disponibles
                            })
                            
                if datos_ciclo:
                    df = pd.DataFrame(datos_ciclo)
                    df_train = df.groupby(["Profesor", "Clave", "Materia"]).agg(
                        Cupo_Total=("Cupo_Total", "sum"),
                        Disponibles=("Disponibles", "sum")
                    ).reset_index()
                    
                    df_train["Saturacion_%"] = df_train.apply(
                        lambda x: round((1 - (x["Disponibles"] / x["Cupo_Total"])) * 100, 2)
                        if x["Cupo_Total"] > 0 else 0, axis=1
                    )
                    
                    ruta_csv = os.path.join(directorio_actual, f"{nombre_centro}_{ciclo}.csv")
                    df_train.to_csv(ruta_csv, index=False, encoding='utf-8')
                    print(f"-> {nombre_centro}_{ciclo}.csv generado con éxito.")
                else:
                    print(f"-> Sin datos para {nombre_centro} en {ciclo}.")
                
                time.sleep(2)
            except Exception as e:
                print(f"Error en {ciclo} para {nombre_centro}: {e}")

if __name__ == "__main__":
    generar_historial_red()
