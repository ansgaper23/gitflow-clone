import assert from 'node:assert/strict';
import { deriveVersionTitle, buildLovableStructuredResponse } from '../backend/src/services/agent.js';

console.log('🧪 Ejecutando pruebas unitarias de blindaje anti-bucle BD y títulos limpios...');

// 1. Test deriveVersionTitle: prioriza interfaz sobre base de datos
const titleUiAndDb = deriveVersionTitle(
  [{ path: 'src/components/ServicesGrid.jsx' }],
  [{ summary: 'create_quotes_table' }]
);
assert.equal(titleUiAndDb, 'Módulo ServicesGrid', 'Debe priorizar archivo UI');

const titleDbOnly = deriveVersionTitle(
  [],
  [{ summary: 'enable_public_quotes_and_relax_types' }]
);
assert.equal(titleDbOnly, 'Public quotes and relax types', 'Debe formatear slug snake_case limpiamente');

// 2. Test buildLovableStructuredResponse: elimina frase fija y construye respuesta dinámica
const respUi = buildLovableStructuredResponse(['Creación de servicios'], {
  proposedChanges: [{ path: 'src/components/ServicesGrid.jsx' }],
  proposedDbChanges: []
});
assert.ok(!respUi.includes('Listo: apliqué los cambios solicitados en la interfaz;'), 'Frase fija no debe existir');
assert.ok(respUi.includes('ServicesGrid'), 'Debe mencionar los componentes creados');

const respDbOnly = buildLovableStructuredResponse(['create_quotes_table'], {
  proposedChanges: [],
  proposedDbChanges: [{ summary: 'create_quotes_table' }]
});
assert.ok(respDbOnly.includes('base de datos PostgreSQL'), 'Debe reflejar cambio en BD cuando no hay cambios de UI');
assert.ok(!respDbOnly.includes('interfaz ya refleja el nuevo diseño'), 'No debe afirmar falsamente que la interfaz cambió');

console.log('✅ Todas las pruebas unitarias pasaron exitosamente.');
process.exit(0);
