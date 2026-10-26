import React from 'react';
import { ActionCard } from './chat/ActionCard';
import { VersionCard } from './chat/VersionCard';
import { PlanCard } from './chat/PlanCard';
import { ResolutionSummary } from './chat/ResolutionSummary';
import { MessageToolbar } from './chat/MessageToolbar';

export default function AssistantMessage({ 
  message, 
  telemetry = [], 
  isGenerating = false, 
  modifiedFiles = [], 
  dbChanges = [],
  onRetry, 
  onViewDiff,
  onRestoreVersion,
  onApprovePlan,
  onAdjustPlan,
  currentProjectPreviewUrl,
  children
}) {
  const isComplete = !isGenerating;
  const status = isGenerating ? 'acting' : 'completed';

  // 1. Detectar si este turno realmente modificó código o base de datos
  const hasCodeChanges = Boolean(
    (Array.isArray(modifiedFiles) && modifiedFiles.length > 0) ||
    (Array.isArray(dbChanges) && dbChanges.length > 0) ||
    message.type === 'code_change' ||
    message.hasDiff
  );

  // 2. Extraer checkpoint y plan si existen en actions
  const checkpointAction = (message.actions || []).find(a => a.type === 'checkpoint');
  const commitSha = checkpointAction?.commitSha || checkpointAction?.trajectory?.commitSha || message.metadata?.commitSha || null;
  const planAction = (message.actions || []).find(a => a.type === 'plan') || message.plan || null;

  // Derivar título limpio para la versión
  const getVersionTitle = () => {
    if (checkpointAction?.summary && checkpointAction.summary !== 'Actualización de interfaz') return checkpointAction.summary;
    if (message.versionTitle && message.versionTitle !== 'Actualización de interfaz') return message.versionTitle;
    if (checkpointAction?.summary) return checkpointAction.summary;
    if (message.versionTitle) return message.versionTitle;
    if (Array.isArray(modifiedFiles) && modifiedFiles.length > 0) {
      const firstFile = modifiedFiles[0];
      const baseName = (typeof firstFile === 'string' ? firstFile : firstFile?.path || '').split('/').pop()?.replace(/\.[^.]+$/, '');
      if (baseName && baseName !== 'index' && baseName !== 'main') {
        if (baseName === 'App') return 'Vista principal y navegación';
        return `Módulo ${baseName}`;
      }
    }
    if (Array.isArray(dbChanges) && dbChanges.length > 0) {
      let s = String(dbChanges[0]?.summary || '').trim();
      if (s && !s.includes('.sql')) {
        s = s.replace(/^(?:create|ensure|provision|enable|setup)_/i, '')
             .replace(/_/g, ' ')
             .trim();
        if (s.length > 0 && s.length < 50) {
          return s.charAt(0).toUpperCase() + s.slice(1);
        }
      }
      return 'Esquema y base de datos';
    }
    return 'Mejoras en la aplicación';
  };

  // Use the active slot URL from the message or fallback to the current active project URL
  const previewUrl = message.previewUrl || currentProjectPreviewUrl || null;

  return (
    <div className="w-full pl-0 sm:pl-2 py-2 font-sans text-zinc-100 flex flex-col gap-3">
      
      {/* 1. Texto breve introductorio de resolución (siempre al inicio) */}
      {isComplete && message.content && (
        <ResolutionSummary content={message.content} />
      )}

      {/* 2. Tarjeta de Plan / Hoja de Ruta si fue propuesto en este turno */}
      {isComplete && planAction && (
        <PlanCard
          plan={planAction}
          onApprove={() => onApprovePlan?.(message.id, planAction)}
          onAdjust={(feedback) => onAdjustPlan?.(message.id, planAction, feedback)}
        />
      )}

      {/* 3. Tarjeta de Versión Estilo Lovable si hubo cambios técnicos */}
      {isComplete && hasCodeChanges && (
        <VersionCard
          title={getVersionTitle()}
          modifiedFiles={modifiedFiles}
          dbChanges={dbChanges}
          isActive={Boolean(previewUrl)}
          commitSha={commitSha}
          messageId={message.id}
          onRestore={onRestoreVersion ? () => onRestoreVersion(message.id, commitSha) : null}
          onViewDiff={onViewDiff}
          onPreview={() => {
            if (previewUrl && typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('flowpro:preview-refresh'));
            }
          }}
        />
      )}

      {/* 4. Tarjetas adicionales si existen (DbChoiceCard, QuestionCard, SecretRequestCard, etc.) */}
      {children && <div className="space-y-4 my-1">{children}</div>}

      {/* 5. MessageToolbar */}
      {isComplete && (
        <MessageToolbar onRetry={onRetry} textToCopy={message.content} />
      )}
    </div>
  );
}
