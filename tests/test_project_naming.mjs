import assert from 'node:assert/strict';
import {
  generateProjectName,
  buildCleanFallbackName,
  ensureUniqueSlug,
  slugify,
  isGenericOrLiteralName,
} from '../backend/src/services/projectNaming.js';

async function runTests() {
  console.log('=== TEST SUITE: GENERACIÓN SEMÁNTICA DE NOMBRES Y SLUGS (ESTILO LOVABLE) ===\n');
  let passed = 0;
  let total = 5;

  // CASO 1: 'construye una web para clinica dental'
  console.log('--- CASO 1: Prompt estándar con verbo "construye" ---');
  {
    const prompt = 'construye una web para clinica dental';
    const res = buildCleanFallbackName(prompt);
    console.log(`Prompt: "${prompt}"`);
    console.log('Resultado:', res);

    assert.ok(!res.name.toLowerCase().includes('construye'), 'El nombre no debe contener el verbo "construye"');
    assert.ok(res.slug === 'clinica-dental' || res.slug === 'clinica-dental-web', `El slug debe ser 'clinica-dental' o 'clinica-dental-web', recibido: ${res.slug}`);
    assert.ok(!/[áéíóúÁÉÍÓÚ]/.test(res.slug), 'El slug no debe tener acentos ni diacríticos');
    console.log('✅ Caso 1 pasado exitosamente.\n');
    passed++;
  }

  // CASO 2: 'Creame una web igual a esta https://electrinovaperu.com/'
  console.log('--- CASO 2: Prompt con URL de referencia externa ---');
  {
    const prompt = 'Creame una web igual a esta https://electrinovaperu.com/';
    const res = buildCleanFallbackName(prompt);
    console.log(`Prompt: "${prompt}"`);
    console.log('Resultado:', res);

    assert.ok(res.name.includes('Electrinova'), 'El nombre debe contener "Electrinova"');
    assert.ok(!res.name.toLowerCase().includes('web igual a esta'), 'El nombre nunca debe ser "Web Igual A Esta"');
    assert.ok(!res.name.toLowerCase().includes('creame'), 'El nombre no debe contener el verbo "creame"');
    assert.ok(res.slug.includes('electrinova'), `El slug debe contener 'electrinova', recibido: ${res.slug}`);
    console.log('✅ Caso 2 pasado exitosamente.\n');
    passed++;
  }

  // CASO 3: Prompt con marca ('app de pedidos para mi restaurante Don José')
  console.log('--- CASO 3: Prompt con marca explícita ---');
  {
    const prompt = 'app de pedidos para mi restaurante Don José';
    const res = buildCleanFallbackName(prompt);
    console.log(`Prompt: "${prompt}"`);
    console.log('Resultado:', res);

    assert.ok(res.name.includes('Don José'), `La marca "Don José" debe aparecer en name, recibido: ${res.name}`);
    assert.ok(res.slug.includes('don-jose'), `El slug debe contener "don-jose", recibido: ${res.slug}`);
    assert.ok(!/[áéíóúÁÉÍÓÚ]/.test(res.slug), 'El slug no debe contener caracteres con acento');
    console.log('✅ Caso 3 pasado exitosamente.\n');
    passed++;
  }

  // CASO 4: Colisión de slug -> genera sufijo numérico (-2, -3)
  console.log('--- CASO 4: Colisión de slug en Base de Datos ---');
  {
    const existingSlugs = new Set(['clinica-dental', 'clinica-dental-2']);
    const mockDbClient = async (candidateSlug) => existingSlugs.has(candidateSlug);

    const resolvedSlug = await ensureUniqueSlug('clinica-dental', null, mockDbClient);
    console.log('Slugs existentes: [clinica-dental, clinica-dental-2]');
    console.log('Slug único generado:', resolvedSlug);

    assert.equal(resolvedSlug, 'clinica-dental-3', 'Debe generar el sufijo numérico incremental "-3"');
    console.log('✅ Caso 4 pasado exitosamente.\n');
    passed++;
  }

  // CASO 5: Simulación de timeout del LLM (>4000ms)
  console.log('--- CASO 5: Timeout o fallback determinista garantizado ---');
  {
    const prompt = 'actúa como un ingeniero senior de machine learning y construye un sistema de inventario inteligente';
    const start = Date.now();
    const res = await generateProjectName(prompt, { simulateTimeout: true });
    const duration = Date.now() - start;

    console.log(`Prompt: "${prompt}"`);
    console.log('Resultado tras timeout simulado:', res);
    console.log(`Duración: ${duration}ms`);

    assert.ok(!res.name.toLowerCase().includes('actúa'), 'El fallback determinista debe eliminar "actúa como"');
    assert.ok(!res.name.toLowerCase().includes('construye'), 'El fallback determinista debe eliminar "construye"');
    assert.ok(res.slug && res.slug.length > 0, 'El slug generado debe ser válido');
    assert.ok(duration < 500, 'El fallback debe responder inmediatamente sin trabar la creación');
    console.log('✅ Caso 5 pasado exitosamente.\n');
    passed++;
  }

  console.log('================================================================');
  console.log(`RESULTADO FINAL: ${passed}/${total} CASOS PASARON CORRECTAMENTE (100%)`);
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('\n❌ ERROR EN SUITE DE PRUEBAS:', err);
  process.exit(1);
});
