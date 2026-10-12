import React, { useState } from 'react';
import { useCloudBuckets, useCloudFiles } from '../../../hooks/useCloudData';
import { HardDrive, Plus, Search, Folder, File, Image as ImageIcon, Link as LinkIcon, Trash2, UploadCloud } from 'lucide-react';

export default function StorageView({ projectId }) {
  const { data: bucketsData, isLoading: isLoadingBuckets } = useCloudBuckets(projectId);
  const [selectedBucket, setSelectedBucket] = useState(null);
  
  const buckets = bucketsData?.buckets || [];

  return (
    <div className="flex h-full border border-[#23252a] rounded-xl overflow-hidden bg-[#141518]">
      <div className="w-64 border-r border-[#23252a] flex flex-col">
        <div className="p-4 border-b border-[#23252a] flex justify-between items-center bg-[#1a1c20]">
          <h3 className="text-[#ededed] font-medium text-sm">Buckets</h3>
          <button className="text-[#8a8f98] hover:text-[#ededed]"><Plus className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoadingBuckets ? (
            <div className="animate-pulse space-y-2 p-2">
              <div className="h-10 bg-[#1a1c20] rounded-lg"></div>
              <div className="h-10 bg-[#1a1c20] rounded-lg"></div>
            </div>
          ) : buckets.length === 0 ? (
            <div className="text-center p-4 text-[#8a8f98] text-xs">No hay buckets</div>
          ) : (
            buckets.map(bucket => (
              <button
                key={bucket.id}
                onClick={() => setSelectedBucket(bucket.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex flex-col gap-1 transition-colors ${
                  selectedBucket === bucket.id 
                    ? 'bg-[#23252a] border border-[#303339]' 
                    : 'border border-transparent hover:bg-[#1a1c20] hover:border-[#23252a]'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2 truncate">
                    <Folder className={`w-4 h-4 ${selectedBucket === bucket.id ? 'text-sky-400' : 'text-[#8a8f98]'}`} />
                    <span className={selectedBucket === bucket.id ? 'text-[#ededed]' : 'text-[#8a8f98]'}>{bucket.name}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between pl-6 text-[10px]">
                  <span className={bucket.public ? 'text-emerald-500' : 'text-amber-500'}>
                    {bucket.public ? 'Público' : 'Privado'}
                  </span>
                  <span className="text-[#6b7280]">{bucket.file_count} archivos</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
      <div className="flex-1 bg-[#0c0d0e] flex flex-col relative overflow-hidden">
        {selectedBucket ? (
          <BucketExplorer projectId={projectId} bucketId={selectedBucket} buckets={buckets} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-full bg-[#1a1c20] flex items-center justify-center mb-4">
              <HardDrive className="w-8 h-8 text-[#8a8f98]" />
            </div>
            <h3 className="text-[#ededed] font-medium text-lg mb-2">Almacenamiento de Archivos</h3>
            <p className="text-[#8a8f98] text-sm max-w-sm mb-6">Selecciona un bucket para explorar, subir y gestionar tus assets, imágenes y documentos estáticos.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function BucketExplorer({ projectId, bucketId, buckets }) {
  const { data, isLoading } = useCloudFiles(projectId, bucketId);
  const bucket = buckets.find(b => b.id === bucketId);
  const files = data?.files || [];
  
  const [searchTerm, setSearchTerm] = useState('');
  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex justify-between items-center p-4 border-b border-[#23252a] bg-[#141518]">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h2 className="text-[#ededed] font-semibold text-lg">{bucket?.name}</h2>
            {bucket?.public ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Público</span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">Privado</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-[#8a8f98] mt-1">
            <span>{files.length} archivos</span>
            <span>•</span>
            <span>{formatSize(bucket?.total_size)} total</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-[#8a8f98] absolute left-2.5 top-1.5" />
            <input type="text" placeholder="Buscar archivo..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="bg-[#1a1c20] border border-[#23252a] rounded-lg pl-8 pr-3 py-1.5 text-sm text-[#ededed] outline-none focus:border-[#3b82f6]/50" />
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#ededed] text-[#0c0d0e] font-medium text-sm hover:bg-white">
            <UploadCloud className="w-4 h-4" />
            <span>Subir</span>
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto bg-[#0c0d0e] p-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full space-y-3">
            <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-[#8a8f98]">Cargando archivos...</span>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full border-2 border-dashed border-[#23252a] rounded-xl bg-[#141518]/50">
            <UploadCloud className="w-10 h-10 text-[#8a8f98] mb-3" />
            <p className="text-[#ededed] font-medium mb-1">Este bucket est? vac?o</p>
            <p className="text-[#8a8f98] text-sm">Sube archivos o int?gralos desde tu c?digo.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredFiles.map(file => {
              const isImage = file.mime_type?.startsWith('image/');
              return (
                <div key={file.id} className="group flex flex-col bg-[#141518] border border-[#23252a] rounded-lg overflow-hidden hover:border-[#303339] transition-colors relative">
                  <div className="aspect-square bg-[#1a1c20] flex items-center justify-center p-4 border-b border-[#23252a] relative overflow-hidden">
                    {isImage ? (
                      <ImageIcon className="w-12 h-12 text-[#303339]" />
                      // Ideally, show an image thumbnail here if public URL is available
                    ) : (
                      <File className="w-12 h-12 text-[#303339]" />
                    )}
                    
                    {/* Hover Actions */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button className="p-2 bg-[#23252a] rounded-full text-[#ededed] hover:bg-[#303339]" title="Copiar URL">
                        <LinkIcon className="w-4 h-4" />
                      </button>
                      <button className="p-2 bg-red-500/20 rounded-full text-red-400 hover:bg-red-500/30" title="Eliminar">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium text-[#ededed] truncate" title={file.name}>{file.name}</p>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-[10px] text-[#8a8f98] bg-[#1a1c20] px-1.5 py-0.5 rounded uppercase">{file.mime_type?.split('/')[1] || 'FILE'}</span>
                      <span className="text-xs text-[#8a8f98]">{formatSize(file.size)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
