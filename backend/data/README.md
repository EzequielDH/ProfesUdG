# Datos — ProfesUdG

Esta carpeta contiene los datos que alimentan el motor de scoring y el
constructor de horarios. **Los archivos reales no se incluyen en el repositorio**
porque son la base del proyecto. Este documento describe
el formato exacto para que puedas generarlos o contribuir con los de tu centro.

---

## Estructura esperada

```
data/
├── {CENTRO}_{CICLO}.csv          # Saturación histórica por ciclo
├── Oferta_Actual_{CENTRO}.csv    # Materias abiertas en el ciclo actual
└── profes/
    └── Profesores_{CENTRO}.csv   # Catálogo de profesores activos
```

Los valores válidos de `{CENTRO}` son:
`CUAAD`, `CUCBA`, `CUCEA`, `CUCEI`, `CUCS`, `CUCSH`, `CUALTOS`,
`CUCIENEGA`, `CUCOSTA`, `CUCSUR`, `CUSUR`, `CUVALLES`, `CUNORTE`,
`CUTONALA`, `UDG_VIRTUAL`, `CU_TLAJOMULCO`, `CU_GUADALAJARA`,
`CU_TLAQUEPAQUE`, `CU_CHAPALA`

Los valores de `{CICLO}` siguen el formato `YYYYPP` donde `PP` es `10`
(ciclo A, ene–jul) o `20` (ciclo B, ago–dic). Ejemplo: `202610` = 2026A.

---

## 1. Saturación histórica — `{CENTRO}_{CICLO}.csv`

Cada fila representa una sección de una materia con su profesor en ese ciclo.

| Columna | Tipo | Descripción |
|---|---|---|
| `Profesor` | texto | Nombre completo en mayúsculas (`APELLIDO, NOMBRE`) |
| `Clave` | texto | Clave de la materia (ej. `I5799`) |
| `Materia` | texto | Nombre de la materia |
| `Cupo_Total` | entero | Cupo máximo de la sección |
| `Disponibles` | entero | Lugares disponibles al cierre del ciclo |
| `Saturacion_%` | decimal | `(Cupo_Total - Disponibles) / Cupo_Total * 100` |

**Ejemplo:**
```csv
Profesor,Clave,Materia,Cupo_Total,Disponibles,Saturacion_%
"GARCIA LOPEZ, JUAN",I5799,PRECALCULO,39,0,100.0
"GARCIA LOPEZ, JUAN",I5800,CALCULO I,35,3,91.43
```

---

## 2. Oferta actual — `Oferta_Actual_{CENTRO}.csv`

Materias abiertas para inscripción en el ciclo vigente, obtenidas de SIIAU.

| Columna | Tipo | Descripción |
|---|---|---|
| `NRC` | texto | Número de referencia del curso (identificador único de sección) |
| `Clave` | texto | Clave de la materia |
| `Materia` | texto | Nombre de la materia |
| `Profesor` | texto | Nombre del profesor (puede tener número al inicio, se elimina automáticamente) |
| `Horas` | texto | Rango horario en formato `HHMM-HHMM` (ej. `0800-0955`) |
| `Dias` | texto | Días de clase en formato de 6 caracteres: posición 0=L, 1=M, 2=I(mié), 3=J, 4=V, 5=S. Punto = no hay clase ese día. Ej: `L.I...` = lunes y miércoles |

**Ejemplo:**
```csv
NRC,Clave,Materia,Profesor,Horas,Dias
121218,I7607,CALCULO I,"01
GARCIA LOPEZ, JUAN",0800-0955,L.I...
```

> Nota: el campo `Profesor` en SIIAU a veces viene en dos líneas (número de grupo
> + nombre). El backend elimina el número automáticamente con regex.

---

## 3. Catálogo de profesores — `profes/Profesores_{CENTRO}.csv`

Lista de todos los profesores activos con sus materias asignadas en el ciclo actual.

| Columna | Tipo | Descripción |
|---|---|---|
| `Profesor` | texto | Nombre completo del profesor |
| `Materia` | texto | Materias que imparte separadas por coma |
| `Clave` | texto | Claves de materias separadas por coma (mismo orden que `Materia`) |
| `NRC` | texto | NRCs de sus secciones separados por coma |

Las primeras filas pueden contener fechas de vigencia del reporte (formato
`DD/MM/YY - DD/MM/YY`); el backend las filtra automáticamente.

**Ejemplo:**
```csv
Profesor,Materia,Clave,NRC
"GARCIA LOPEZ, JUAN","PRECALCULO, CALCULO I","I5799, I5800","88087, 115632"
```

---

## Fuente de los datos

Los datos se obtienen de **SIIAU** de la Universidad de Guadalajara.
Son datos públicos disponibles para estudiantes.
