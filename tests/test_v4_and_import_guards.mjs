import assert from 'node:assert';
import { sanitizeStylesheets, validateImportsAgainstPackageJson } from '../backend/src/services/uiIntegrityGuard.js';

console.log('🧪 Iniciando suite de pruebas: test_v4_and_import_guards.mjs\n');

// ── PRUEBA 1: Sanitización de hojas de estilo (Tailwind v4 -> Tailwind v3) ──
console.log('--- Caso 1: Sanitización de Tailwind v4 en src/index.css ---');
const rawV4Css = `
@import "tailwindcss";

@theme {
  --font-display: "Oswald", sans-serif;
  --color-brand: #3b82f6;
}

body {
  margin: 0;
  font-family: sans-serif;
}
`.trim();

const sanitizedCss = sanitizeStylesheets('src/index.css', rawV4Css);

// Aserción 1.1: Se eliminó el @import "tailwindcss"
assert.ok(!sanitizedCss.includes('@import "tailwindcss"'), 'El @import "tailwindcss" no debe estar presente');
assert.ok(!sanitizedCss.includes("@import 'tailwindcss'"), "El @import 'tailwindcss' no debe estar presente");

// Aserción 1.2: Se eliminó el bloque @theme
assert.ok(!sanitizedCss.includes('@theme'), 'El bloque @theme no debe estar presente');
assert.ok(!sanitizedCss.includes('--font-display'), 'Las variables dentro de @theme no deben quedar como bloque no reconocido');

// Aserción 1.3: Se inyectaron las 3 directivas canónicas de Tailwind v3
assert.ok(sanitizedCss.includes('@tailwind base;'), 'Debe contener @tailwind base;');
assert.ok(sanitizedCss.includes('@tailwind components;'), 'Debe contener @tailwind components;');
assert.ok(sanitizedCss.includes('@tailwind utilities;'), 'Debe contener @tailwind utilities;');

// Aserción 1.4: Se conservan las reglas CSS normales
assert.ok(sanitizedCss.includes('body {'), 'Debe conservar la regla body');

// Aserción 1.5: Archivos CSS que no son raíz no se alteran
const componentCss = `.card { color: red; }`;
assert.strictEqual(sanitizeStylesheets('src/components/Card.css', componentCss), componentCss, 'No debe modificar CSS no raíz');

console.log('✅ Caso 1 superado: Tailwind v4 sanitizado exitosamente a directivas v3 sin bloques @theme incompatibles.\n');


// ── PRUEBA 2: Validación de dependencias existentes contra package.json ──
console.log('--- Caso 2: Import de dependencia existente (lucide-react) en package.json ---');
const mockPackageJson = {
  dependencies: {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "lucide-react": "^0.460.0",
    "clsx": "^2.1.1"
  },
  devDependencies: {
    "vite": "^5.4.2"
  }
};

const validComponentCode = `
import React, { useState } from 'react';
import { Camera, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from './components/Button';
import { cn } from '@/lib/utils';

export function Header() {
  return (
    <header className="flex items-center gap-2">
      <Camera className="w-5 h-5 text-blue-500" />
      <span>Vista Previa</span>
    </header>
  );
}
`;

const validResult = validateImportsAgainstPackageJson('src/components/Header.jsx', validComponentCode, mockPackageJson);

assert.strictEqual(validResult.valid, true, 'El código con dependencias existentes debe ser válido');
assert.deepStrictEqual(validResult.missingPackages, [], 'No debe haber paquetes faltantes');
assert.strictEqual(validResult.error, undefined, 'No debe arrojar mensaje de error');

console.log('✅ Caso 2 superado: Dependencias instaladas (lucide-react, clsx) permitidas correctamente.\n');


// ── PRUEBA 3: Intercepción de dependencia inexistente ──
console.log('--- Caso 3: Intercepción de import inexistente (paquete-inexistente-xyz) ---');
const invalidComponentCode = `
import React from 'react';
import { algo } from 'paquete-inexistente-xyz';
import { Camera } from 'lucide-react';

export function Widget() {
  return <div>{algo()}</div>;
}
`;

const invalidResult = validateImportsAgainstPackageJson('src/components/Widget.jsx', invalidComponentCode, mockPackageJson);

assert.strictEqual(invalidResult.valid, false, 'El código con paquetes ausentes debe ser inválido');
assert.ok(invalidResult.missingPackages.includes('paquete-inexistente-xyz'), 'Debe detectar paquete-inexistente-xyz');
assert.ok(invalidResult.error.includes('paquete-inexistente-xyz'), 'El mensaje de error debe nombrar el paquete');
assert.ok(
  invalidResult.error.includes("Error de validación: El paquete 'paquete-inexistente-xyz' no está instalado en este proyecto"),
  'El mensaje de error debe coincidir con el formato canónico exigido'
);

console.log('✅ Caso 3 superado: Dependencia ausente detectada y bloqueada limpiamente con feedback estructurado.\n');


// ── PRUEBA 4: Manejo de imports con scope (@tabler/icons-react) y dinámicos ──
console.log('--- Caso 4: Imports con scope y dinámicos (import(...)) ---');
const dynamicCode = `
import { Dialog } from '@radix-ui/react-dialog';

export async function loadExtra() {
  const mod = await import('libreria-fantasma-123/submodulo');
  return mod;
}
`;

const dynamicResult = validateImportsAgainstPackageJson('src/lib/loader.ts', dynamicCode, mockPackageJson);
assert.strictEqual(dynamicResult.valid, false, 'Debe detectar paquetes con scope o dinámicos ausentes');
assert.ok(dynamicResult.missingPackages.includes('@radix-ui/react-dialog'), 'Debe detectar @radix-ui/react-dialog');
assert.ok(dynamicResult.missingPackages.includes('libreria-fantasma-123'), 'Debe detectar libreria-fantasma-123');

console.log('✅ Caso 4 superado: Soporte de scoped packages y dynamic imports validado.\n');

console.log('🎉 TODAS LAS PRUEBAS (4/4) PASARON CON ÉXITO.');
