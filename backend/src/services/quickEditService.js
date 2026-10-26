// backend/src/services/quickEditService.js
// SERVICIO DE EDICIÓN VISUAL INSTANTÁNEA ZERO-LLM CON SALVAGUARDA DE FALLBACK A IA (FASE 4)

import path from 'node:path'
import { getProjectSemanticGraph, findMatchingFileForElement } from './semanticGraph.js'
import { readAllProjectFiles, writeProjectFile } from './projectStorage.js'
import { mutateTailwindClasses } from './tailwindMutator.js'
import { applyPatch } from './fuzzyPatcher.js'
import { validateContent } from './syntaxValidator.js'
import { refreshPreview } from './previewOrchestrator.js'
import { commitCheckpoint } from './gitCheckpoint.js'
import { isVirtualRepo } from './projectResolver.js'
import fs from 'node:fs'

export const DYNAMIC_JSX_PATTERNS = [
  /\{[^{}]*\b(props|state|item|data|user|name|title|text|desc|value|label|t\(|format|msg)\b[^{}]*\}/i,
  /\$\{[^}]+\}/,
  /\{\/\*[\s\S]*?\*\/\}/
];

export function isDynamicExpression(str) {
  if (!str || typeof str !== 'string') return false;
  const trimmed = str.trim();
  if (/^\{.*\}$/.test(trimmed)) return true;
  return DYNAMIC_JSX_PATTERNS.some((pat) => pat.test(trimmed));
}

/**
 * Intenta aplicar una edición directa sobre el código JSX sin consumir tokens de LLM.
 * Si el texto o clases provienen de variables, expresiones dinámicas o no pueden
 * resolverse unívocamente, devuelve FALLBACK_REQUIRED para que el Agente IA lo procese.
 * 
 * @param {object} params
 * @param {object} params.project
 * @param {object} params.user
 * @param {object} params.elementContext
 * @param {'edit_text'|'edit_styles'} params.action
 * @param {string} [params.newText]
 * @param {string} [params.newClasses]
 * @param {object} [params.tailwindUpdates]
 * @param {string} [params.workspaceDir]
 * @returns {Promise<{ status: 'APPLIED_DIRECTLY'|'FALLBACK_REQUIRED', reason?: string, message?: string, filePath?: string }>}
 */
export async function executeQuickEdit({
  project,
  user,
  elementContext,
  action,
  newText,
  newClasses,
  tailwindUpdates,
  workspaceDir
}) {
  if (!elementContext) {
    return { status: 'FALLBACK_REQUIRED', reason: 'NO_ELEMENT_CONTEXT', message: 'No se recibió el contexto del elemento seleccionado.' };
  }

  // 1. Obtener archivos del proyecto y grafo semántico
  let filesMap = {};
  if (isVirtualRepo(project.repo_full_name)) {
    const rawFiles = await readAllProjectFiles(project).catch(() => []);
    for (const f of rawFiles) {
      filesMap[f.path] = f.content;
    }
  } else if (workspaceDir && fs.existsSync(workspaceDir)) {
    // Si hay un workspace físico disponible
    function scanDir(dir, base = '') {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
          const full = path.join(dir, entry.name);
          const rel = base ? `${base}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            scanDir(full, rel);
          } else if (/\.(jsx?|tsx?|html|css|json)$/i.test(entry.name)) {
            filesMap[rel] = fs.readFileSync(full, 'utf-8');
          }
        }
      } catch (_) {}
    }
    scanDir(workspaceDir);
  }

  const { graph: semanticGraph } = await getProjectSemanticGraph(project, user.github_access_token).catch(() => ({ graph: {} }));

  // 2. Localizar el archivo que renderiza el elemento
  let targetFile = null;
  if (elementContext.source?.fileName) {
    const norm = elementContext.source.fileName.replace(/\\/g, '/');
    for (const p of Object.keys(filesMap)) {
      if (norm.endsWith(p) || p.endsWith(norm)) {
        targetFile = p;
        break;
      }
    }
  }

  if (!targetFile) {
    targetFile = findMatchingFileForElement(semanticGraph, filesMap, elementContext);
  }

  if (!targetFile || !filesMap[targetFile]) {
    return {
      status: 'FALLBACK_REQUIRED',
      reason: 'FILE_NOT_FOUND',
      message: `No se encontró de forma única el archivo fuente para <${elementContext.componentName || elementContext.tagName}>.`
    };
  }

  let originalContent = filesMap[targetFile];
  let patchedContent = originalContent;

  // 3. Procesar según la acción solicitada
  if (action === 'edit_text') {
    const oldText = (elementContext.innerText || '').trim();
    const replacementText = String(newText !== undefined ? newText : '').trim();

    if (!oldText) {
      return { status: 'FALLBACK_REQUIRED', reason: 'EMPTY_SOURCE_TEXT', message: 'El elemento seleccionado no tiene texto fijo identificable.' };
    }

    // SALVAGUARDA DE TEXTOS DINÁMICOS:
    // Si el texto literal no existe exactamente en el archivo, proviene de props/variables
    if (!originalContent.includes(oldText)) {
      return {
        status: 'FALLBACK_REQUIRED',
        reason: 'DYNAMIC_EXPRESSION',
        message: `El texto "${oldText}" no aparece como literal en ${targetFile}. Es probable que provenga de una variable o expresión dinámica.`
      };
    }

    // Verificar si el archivo tiene expresiones dinámicas que puedan colisionar
    for (const pat of DYNAMIC_JSX_PATTERNS) {
      if (pat.test(oldText)) {
        return {
          status: 'FALLBACK_REQUIRED',
          reason: 'DYNAMIC_EXPRESSION',
          message: 'El texto seleccionado contiene marcadores o llaves de expresión JSX.'
        };
      }
    }

    // Comprobar número de apariciones
    const occurrences = originalContent.split(oldText).length - 1;
    if (occurrences > 1) {
      // Intentar anclar con la etiqueta HTML o componente
      const tag = elementContext.tagName ? elementContext.tagName.toLowerCase() : null;
      let anchoredReplaced = false;

      if (tag) {
        // Buscar patrón tipo <tag ...>...oldText...</tag>
        const tagRegex = new RegExp(`(<${tag}[^>]*>)([\\s\\S]*?)(<\\/${tag}>)`, 'i');
        const match = originalContent.match(tagRegex);
        if (match && match[2].includes(oldText)) {
          const replacedSection = match[2].replace(oldText, replacementText);
          patchedContent = originalContent.replace(match[0], `${match[1]}${replacedSection}${match[3]}`);
          anchoredReplaced = true;
        }
      }

      if (!anchoredReplaced) {
        return {
          status: 'FALLBACK_REQUIRED',
          reason: 'AMBIGUOUS_MATCH',
          message: `El texto "${oldText}" aparece ${occurrences} veces en ${targetFile}. Se deriva al Agente IA para evitar cambios colaterales.`
        };
      }
    } else {
      // Aparición única: reemplazo directo seguro
      patchedContent = originalContent.replace(oldText, replacementText);
    }

  } else if (action === 'edit_styles') {
    const oldClasses = (elementContext.className || '').trim();
    let finalClasses = newClasses;

    if (tailwindUpdates && typeof tailwindUpdates === 'object') {
      finalClasses = mutateTailwindClasses(oldClasses, tailwindUpdates);
    }

    if (!finalClasses || finalClasses === oldClasses) {
      return { status: 'APPLIED_DIRECTLY', filePath: targetFile, updatedContent: originalContent };
    }

    // Intentar localizar el atributo className en el archivo
    let replacedStyle = false;

    // Caso 1: className="oldClasses" exacto
    if (oldClasses && originalContent.includes(`className="${oldClasses}"`)) {
      patchedContent = originalContent.replace(`className="${oldClasses}"`, `className="${finalClasses}"`);
      replacedStyle = true;
    } else if (oldClasses && originalContent.includes(`className='${oldClasses}'`)) {
      patchedContent = originalContent.replace(`className='${oldClasses}'`, `className='${finalClasses}'`);
      replacedStyle = true;
    } else {
      // Caso 2: El componente puede tener clases distribuidas o subconjunto coincidente
      // Buscar la etiqueta del elemento
      const tag = elementContext.tagName ? elementContext.tagName.toLowerCase() : '';
      const comp = elementContext.componentName || '';
      const identifier = comp || tag;

      if (identifier) {
        // Regex para capturar className="..." dentro de la etiqueta
        const classAttrRegex = new RegExp(`(<(?:${identifier})[^>]*className=["'])([^"']*)(["'][^>]*>)`, 'i');
        const match = originalContent.match(classAttrRegex);
        if (match) {
          const existingInCode = match[2];
          const mutated = tailwindUpdates
            ? mutateTailwindClasses(existingInCode, tailwindUpdates)
            : finalClasses;

          patchedContent = originalContent.replace(match[0], `${match[1]}${mutated}${match[3]}`);
          replacedStyle = true;
        }
      }
    }

    if (!replacedStyle) {
      return {
        status: 'FALLBACK_REQUIRED',
        reason: 'DYNAMIC_EXPRESSION',
        message: 'Las clases del elemento se construyen con clsx(), twMerge() o expresiones dinámicas.'
      };
    }
  } else {
    return { status: 'FALLBACK_REQUIRED', reason: 'UNKNOWN_ACTION', message: `Acción desconocida: ${action}` };
  }

  // 4. Validar sintaxis del código generado
  const validation = validateContent(targetFile, patchedContent);
  if (!validation.valid) {
    return {
      status: 'FALLBACK_REQUIRED',
      reason: 'SYNTAX_VALIDATION_FAILED',
      message: `La mutación directa generó un error de sintaxis: ${validation.error}. Se transfiere al Agente IA.`
    };
  }

  // 5. Persistir cambios de forma atómica
  if (isVirtualRepo(project.repo_full_name)) {
    await writeProjectFile(project, user?.github_access_token, {
      path: targetFile,
      newContent: patchedContent,
      summary: `Zero-LLM Quick Edit: ${action}`
    }).catch(() => {});
  }

  // Escribir en workspace físico si está disponible para disparo instantáneo de Vite HMR
  if (workspaceDir && fs.existsSync(workspaceDir)) {
    const absPath = path.join(workspaceDir, targetFile);
    try {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, patchedContent, 'utf-8');
      
      // Git commit de checkpoint instantáneo
      const turnId = `quick_edit_${Date.now()}`;
      await commitCheckpoint(workspaceDir, turnId, `Zero-LLM Quick Edit: ${action} en ${targetFile}`).catch(() => null);
    } catch (_) {}
  }

  // Refrescar preview en el orquestador
  const ownerKey = `user:${user.id}`;
  refreshPreview(ownerKey, project).catch(() => {});

  return {
    status: 'APPLIED_DIRECTLY',
    filePath: targetFile,
    updatedContent: patchedContent
  };
}
