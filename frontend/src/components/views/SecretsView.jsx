import React from 'react';
import ServerSecretsSection from '../ServerSecretsSection';

export default function SecretsView({ projectId }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Seguridad y Secrets</h2>
          <p className="text-xs text-[#8a8f98]">
            Variables de entorno, llaves privadas y credenciales seguras.
          </p>
        </div>
      </div>
      <ServerSecretsSection projectId={projectId} />
    </div>
  );
}
