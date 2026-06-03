/* Mock Data for Profile Modal */

const PROFESORES = [
  {
    id: 1,
    iniciales: 'MR',
    nombre: 'Dra. María Rodríguez',
    cu: 'CUCEI',
    depto: 'Departamento de Matemáticas',
    materias: ['Cálculo Diferencial', 'Álgebra Lineal'],
    reseñas: 142,
    rating: 4.8,
    dificultad: 3.2,
    recomienda: 96,
    avatar: 'av-blue'
  },
  {
    id: 2,
    iniciales: 'JM',
    nombre: 'Mtro. Jorge Martínez',
    cu: 'CUCEA',
    depto: 'Departamento de Mercadotecnia',
    materias: ['Mercadotecnia', 'Negocios Internacionales'],
    reseñas: 89,
    rating: 4.6,
    dificultad: 2.8,
    recomienda: 91,
    avatar: 'av-purple'
  },
  {
    id: 3,
    iniciales: 'LH',
    nombre: 'Dr. Luis Hernández',
    cu: 'CUCS',
    depto: 'Departamento de Ciencias Médicas',
    materias: ['Anatomía', 'Fisiología'],
    reseñas: 203,
    rating: 4.5,
    dificultad: 4.1,
    recomienda: 88,
    avatar: 'av-coral'
  },
  {
    id: 4,
    iniciales: 'SP',
    nombre: 'Mtra. Sofía Pérez',
    cu: 'CUAAD',
    depto: 'Departamento de Diseño',
    materias: ['Diseño UX', 'Tipografía'],
    reseñas: 76,
    rating: 4.7,
    dificultad: 3.5,
    recomienda: 94,
    avatar: 'av-teal'
  },
  {
    id: 5,
    iniciales: 'AG',
    nombre: 'Dra. Ana García López',
    cu: 'CUCEI',
    depto: 'Departamento de Ciencias Computacionales',
    materias: ['Estructura de Datos', 'Algoritmos', 'POO'],
    reseñas: 87,
    rating: 4.7,
    dificultad: 3.8,
    recomienda: 93,
    avatar: 'av-blue'
  },
  {
    id: 6,
    iniciales: 'RC',
    nombre: 'Mtro. Ricardo Castillo',
    cu: 'CUCEA',
    depto: 'Departamento de Contaduría',
    materias: ['Contabilidad Financiera', 'Auditoría'],
    reseñas: 54,
    rating: 4.3,
    dificultad: 3.0,
    recomienda: 85,
    avatar: 'av-purple'
  }
];

// Demo reviews for the professor profile modal
const RESEÑAS_DEMO = [
  {
    rating: 5.0,
    materia: 'Estructura de Datos',
    ciclo: '2026A',
    dias: 3,
    texto: 'Explica con paciencia y los ejercicios realmente preparan para los exámenes. Asistencia opcional pero conviene ir.',
    utiles: 24,
    asistencia: 'opcional',
    volveria: 'sí',
    tipo: 'good',
    verificada: true
  },
  {
    rating: 4.0,
    materia: 'Algoritmos',
    ciclo: '2025B',
    dias: 14,
    texto: 'Tareas pesadas pero justas. Los proyectos finales son retadores; aprendes mucho si te aplicas.',
    utiles: 18,
    asistencia: 'obligatoria',
    volveria: 'sí',
    tipo: 'mid',
    verificada: false
  }
];

// Module exports for future build systems
// export { PROFESORES, RESEÑAS_DEMO };
