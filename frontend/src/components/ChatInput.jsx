import React, { useRef, useEffect, useState } from 'react';
import { 
  Plus, 
  ArrowUp, 
  Square, 
  Mic, 
  X, 
  ChevronDown,
  FileArchive,
  File 
} from 'lucide-react';
import { api } from '../lib/api';
import { useChatAttachments } from '../hooks/useChatAttachments';

export function ChatInput({
  defaultAgentId,
  projectId,
  onSendMessage,
  onStopGeneration,
  isGenerating = false,
  mode = 'chat',
  setMode,
  selectedElement = null,
  onClearSelectedElement,
  isInspecting = false,
  onToggleInspect
}) {
  const [text, setText] = useState('');
  const [showModeMenu, setShowModeMenu] = useState(false);

  const [skills, setSkills] = useState([]);
  const [showSkillsMenu, setShowSkillsMenu] = useState(false);

  const [agents, setAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [showAgentMenu, setShowAgentMenu] = useState(false);

  useEffect(() => {
    api.listAgents()
      .then(res => setAgents(res.agents || []))
      .catch(err => console.error('Failed to load agents:', err));
  }, []);

  // Update selected agent if project changes default
  useEffect(() => {
    if (defaultAgentId) {
      setSelectedAgentId(defaultAgentId);
    }
  }, [defaultAgentId]);

  const [skillSearch, setSkillSearch] = useState('');

  useEffect(() => {
    if (projectId) {
      api.listProjectSkills(projectId)
        .then(res => setSkills(res.skills || []))
        .catch(err => console.error('Failed to load skills:', err));
    }
  }, [projectId]);

  const handleTextChange = (e) => {
    const val = e.target.value;
    setText(val);
    
    // Check if user is typing a slash command
    const cursor = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursor);
    const words = textBeforeCursor.split(/\s+/);
    const lastWord = words[words.length - 1];
    
    if (lastWord.startsWith('/')) {
      setShowSkillsMenu(true);
      setSkillSearch(lastWord.slice(1).toLowerCase());
    } else {
      setShowSkillsMenu(false);
    }
  };

  const insertSkill = (skillName) => {
    const cursor = textareaRef.current.selectionStart;
    const textBeforeCursor = text.slice(0, cursor);
    const textAfterCursor = text.slice(cursor);
    
    const words = textBeforeCursor.split(/\s+/);
    words.pop(); // Remove the /search word
    const newTextBefore = words.join(' ') + (words.length > 0 ? ' ' : '') + '@' + skillName + ' ';
    
    setText(newTextBefore + textAfterCursor);
    setShowSkillsMenu(false);
    
    // Focus back and set cursor
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = newTextBefore.length;
        textareaRef.current.selectionEnd = newTextBefore.length;
      }
    }, 0);
  };

  const filteredSkills = skills.filter(s => s.name.toLowerCase().includes(skillSearch));

  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const {
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    handlePaste,
  } = useChatAttachments();

  // Auto-resize dinámico del textarea hasta 160px
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [text]);

  
  useEffect(() => {
    if (attachments.length > 0 && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [attachments.length]);

  // Enfocar textarea automáticamente al seleccionar un elemento de la vista previa
  useEffect(() => {
    if (selectedElement && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [selectedElement]);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if ((!text.trim() && attachments.length === 0) || isGenerating) {
      if (isGenerating && onStopGeneration) {
        onStopGeneration();
      }
      return;
    }
    let finalText = text.trim();
    if (!finalText && attachments.length > 0) {
      finalText = "He subido estos archivos para el proyecto.";
    }
    
    // Backup para rollback
    const previousText = finalText;
    const previousAttachments = [...attachments];

    // Limpieza optimista inmediata
    setText('');
    clearAttachments();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    
    try {
      await onSendMessage(previousText, previousAttachments.map(a => a.file || a), selectedAgentId);
    } catch (err) {
      console.error('Error onSendMessage:', err);
      // Rollback
      setText(previousText);
      // Opcional: restaurar attachments si exporta setAttachments
      if (typeof setAttachments === 'function') setAttachments(previousAttachments);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Convertimos el modo "chat", "build", "plan" a formato capitalizado para mostrar
  const displayMode = mode.charAt(0).toUpperCase() + mode.slice(1);

  return (
    <div className="w-full select-none px-3 pb-3 sm:px-4 sm:pb-4 max-w-5xl mx-auto">
      <div 
        onPaste={handlePaste}
        className="relative rounded-[26px] bg-[#1c1c1f] border border-white/[0.08] shadow-2xl p-3 pt-3.5 transition-all focus-within:border-white/20"
      >
        {/* Tray de miniaturas de imágenes adjuntas */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-2 pb-3 overflow-y-auto max-h-32 no-scrollbar">
            {attachments.map((item) => (
              <div 
                key={item.id} 
                className={item.isImage 
                  ? "relative group flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-white/10 bg-black/40" 
                  : "flex items-center gap-2 bg-[#202126] border border-[#2e3138] px-2.5 py-1.5 rounded-lg text-xs text-[#ededed]"
                }
              >
                {item.isImage ? (
                  <>
                    <img 
                      src={item.previewUrl} 
                      alt={item.name} 
                      className="w-full h-full object-cover" 
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(item.id)}
                      className="absolute top-1 right-1 p-0.5 rounded-full bg-black/70 text-white/80 hover:text-white hover:bg-black transition-all opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    {item.isZip ? <FileArchive className="w-4 h-4 text-[#8a8f98]" /> : <File className="w-4 h-4 text-[#8a8f98]" />}
                    <span className="font-medium max-w-[200px] truncate">{item.name}</span>
                    <span className="text-[#8a8f98]">({(item.size / 1024).toFixed(1)} KB)</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(item.id)}
                      className="ml-1 p-0.5 hover:bg-[#2c2e35] rounded text-[#8a8f98] hover:text-white transition-colors"
                      title="Quitar archivo"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        
        {/* Skills Menu Popup */}
        {showSkillsMenu && filteredSkills.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 w-64 bg-[#1e1f23] border border-[#27282d] rounded-xl shadow-xl overflow-hidden z-50">
            <div className="px-3 py-2 text-[10px] font-bold text-muted uppercase tracking-wider bg-[#18191c] border-b border-[#27282d]">
              Skills disponibles
            </div>
            <div className="max-h-48 overflow-y-auto base-ui-disable-scrollbar">
              {filteredSkills.map(skill => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => insertSkill(skill.name)}
                  className="w-full text-left px-3 py-2 hover:bg-[#27282d] flex flex-col gap-1 transition-colors"
                >
                  <span className="text-[13px] text-text font-medium">/{skill.name}</span>
                  {skill.description && <span className="text-[11px] text-muted line-clamp-1">{skill.description}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chip de Elemento Seleccionado en Preview (Click-to-Edit) */}
        {selectedElement && (
          <div className="flex items-center gap-2 mb-2 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300 w-fit max-w-full animate-in fade-in duration-150">
            <span className="shrink-0 text-sm">🎯</span>
            <span className="font-semibold text-blue-200 shrink-0">
              Seleccionado:
            </span>
            <span className="font-mono bg-blue-500/20 px-1.5 py-0.5 rounded text-[11px] text-blue-200 shrink-0">
              {selectedElement.componentName ? `<${selectedElement.componentName} />` : `<${selectedElement.tagName || 'elemento'}>`}
            </span>
            {(selectedElement.sourceFile || selectedElement.source?.fileName) && (
              <span className="font-mono bg-indigo-500/20 border border-indigo-500/30 px-1.5 py-0.5 rounded text-[11px] text-indigo-200 shrink-0">
                {(selectedElement.sourceFile || selectedElement.source.fileName).split('/').pop()}:{(selectedElement.sourceLine || selectedElement.source?.lineNumber || '')}
              </span>
            )}
            {selectedElement.innerText && (
              <span className="truncate text-zinc-300 max-w-[200px]">
                "{selectedElement.innerText}"
              </span>
            )}
            <button
              type="button"
              onClick={onClearSelectedElement}
              className="ml-1 p-0.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
              title="Quitar elemento seleccionado"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Campo de texto / Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder={isGenerating ? "Añadir seguimiento a la cola..." : "Pregúntale a FlowPro..."}
          rows={1}
          className="w-full bg-transparent px-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none resize-none leading-relaxed overflow-y-auto max-h-40 font-normal"
        />

        {/* Barra inferior de controles */}
        <div className="flex items-center justify-between pt-3 px-1">
          {/* Botón de adjuntos (+) y Selector de elemento */}
          <div className="flex items-center gap-1.5">
            <input 
              ref={fileInputRef} 
              type="file" 
              multiple 
               
              className="hidden" 
              onChange={(e) => e.target.files && addFiles(e.target.files)} 
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-zinc-400 hover:text-white flex items-center justify-center transition-colors"
              title="Añadir captura o archivo"
            >
              <Plus className="w-4 h-4 stroke-[2.2]" />
            </button>
          </div>

          {/* Grupo derecho: Selector de modo + Micrófono + Botón Enviar */}
          <div className="flex items-center gap-2 relative">
            
            {/* Agente Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAgentMenu(!showAgentMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#2b2b2f] hover:bg-[#343439] text-xs font-medium text-zinc-200 border border-white/5 transition-colors"
                title="Seleccionar Agente"
              >
                <span>{selectedAgentId ? (agents.find(a => a.id === selectedAgentId)?.icon || '🤖') : '🤖 FlowPro'} ▾</span>
              </button>

              {showAgentMenu && (
                <div className="absolute bottom-full right-0 mb-2 w-48 py-1 rounded-xl bg-[#242428] border border-white/10 shadow-xl z-50 text-xs max-h-60 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => { setSelectedAgentId(null); setShowAgentMenu(false); }}
                    className={`w-full text-left px-3 py-2 hover:bg-white/10 transition-colors ${!selectedAgentId ? 'text-white font-semibold' : 'text-zinc-400'}`}
                  >
                    🤖 FlowPro (Predeterminado)
                  </button>
                  {agents.map(a => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => { setSelectedAgentId(a.id); setShowAgentMenu(false); }}
                      className={`w-full text-left px-3 py-2 hover:bg-white/10 transition-colors flex items-center gap-2 ${selectedAgentId === a.id ? 'text-white font-semibold' : 'text-zinc-400'}`}
                    >
                      <span>{a.icon}</span> <span className="truncate">{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Pill de Modo (Estilo neutro discreto como Lovable) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowModeMenu(!showModeMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#2b2b2f] hover:bg-[#343439] text-xs font-medium text-zinc-200 border border-white/5 transition-colors"
              >
                <span>{displayMode === 'Build' ? 'Build ▾' : `${displayMode} ▾`}</span>
              </button>

              {/* Menú desplegable de modo */}
              {showModeMenu && (
                <div className="absolute bottom-full right-0 mb-2 w-32 py-1 rounded-xl bg-[#242428] border border-white/10 shadow-xl z-50 text-xs">
                  {['chat', 'plan', 'build'].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setMode(m); setShowModeMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-white/10 transition-colors ${
                        mode === m ? 'text-white font-semibold' : 'text-zinc-400'
                      }`}
                    >
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Micrófono */}
            <button
              type="button"
              className="w-8 h-8 rounded-full hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 flex items-center justify-center transition-colors"
              title="Entrada por voz"
            >
              <Mic className="w-4 h-4" />
            </button>

            {/* Botón de Enviar (Círculo elegante con flecha o stop) */}
            {isGenerating ? (
              <button
                type="button"
                onClick={onStopGeneration}
                className="w-8 h-8 rounded-full bg-zinc-800 text-red-400 hover:bg-zinc-700 flex items-center justify-center transition-all duration-200 shadow-md"
                title="Detener generación"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!text.trim() && attachments.length === 0}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ${
                  (text.trim() || attachments.length > 0)
                    ? 'bg-zinc-200 text-zinc-950 hover:bg-white scale-100 shadow-md'
                    : 'bg-[#2e2e32] text-zinc-500 cursor-not-allowed'
                }`}
                title="Enviar mensaje"
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
