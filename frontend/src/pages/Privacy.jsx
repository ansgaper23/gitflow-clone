import LegalLayout from '../components/legal/LegalLayout.jsx'

// Política genérica pero honesta sobre lo que FlowPro realmente recolecta (según el código:
// cuenta, contenido de proyectos, pagos vía Stripe, analíticas de sitios publicados, proveedores
// de IA de terceros). No reemplaza asesoría legal, sobre todo para RGPD/CCPA si hay usuarios en
// esas jurisdicciones.
export default function Privacy() {
  return (
    <LegalLayout title="Política de Privacidad" updated="29 de agosto de 2026">
      <p>
        Esta política explica qué datos recopila FlowPro, para qué los usa y con quién los comparte.
        Al usar el Servicio, aceptás esta política.
      </p>

      <section>
        <h2 className="text-lg font-bold text-text">1. Qué datos recopilamos</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><strong className="text-text">Datos de cuenta:</strong> email, nombre, y contraseña (encriptada) o identidad de GitHub/Google si te registrás con esos proveedores.</li>
          <li><strong className="text-text">Contenido de tus proyectos:</strong> los mensajes que le mandás al agente de IA, el código generado, y los archivos que subís (incluyendo imágenes de diseño o skills).</li>
          <li><strong className="text-text">Datos de pago:</strong> el historial de qué plan compraste y cuándo. Los datos de tu tarjeta los procesa Stripe directamente — FlowPro nunca los ve ni los almacena.</li>
          <li><strong className="text-text">Analíticas de sitios publicados:</strong> si publicás un sitio con FlowPro, recopilamos datos básicos de sus visitantes (dirección IP, user-agent, página visitada) para mostrarte un resumen de tráfico. Esto es sobre los visitantes de TU sitio publicado, no sobre vos como usuario de FlowPro.</li>
          <li><strong className="text-text">Datos técnicos:</strong> dirección IP, tipo de navegador y registros de uso del Servicio, para seguridad y para diagnosticar errores.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">2. Cómo usamos tus datos</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Para operar el Servicio: crear tus proyectos, correr el agente de IA, y guardar tu historial de conversación.</li>
          <li>Para procesar pagos y darte acceso al plan que compraste.</li>
          <li>Para dar soporte cuando nos escribís con un problema.</li>
          <li>Para mejorar el Servicio (por ejemplo, entender qué falla más seguido en el agente).</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">3. Con quién compartimos datos</h2>
        <p className="mt-2">No vendemos tus datos. Los compartimos únicamente con:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><strong className="text-text">GitHub:</strong> para crear y modificar el repositorio donde vive el código de tu proyecto.</li>
          <li><strong className="text-text">Proveedores de modelos de IA</strong> (como Anthropic, Google o DeepSeek, o el proveedor que vos mismo configures si conectás tu propia clave): reciben el contenido de tus mensajes y tu código para poder generar las respuestas y cambios que pedís.</li>
          <li><strong className="text-text">Supabase:</strong> aloja la base de datos donde se guarda tu cuenta y tus proyectos.</li>
          <li><strong className="text-text">Stripe:</strong> procesa tus pagos de forma directa y segura.</li>
        </ul>
        <p className="mt-2">
          Podemos también divulgar información si la ley nos obliga, o para proteger la seguridad del
          Servicio y de otros usuarios.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">4. Cookies y almacenamiento local</h2>
        <p className="mt-2">
          Guardamos tu sesión de inicio de sesión en el almacenamiento local de tu navegador (no en una
          cookie de terceros). Usamos una cookie técnica de corta duración para verificar el acceso a
          las vistas previas de tus proyectos mientras los estás editando.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">5. Retención de datos</h2>
        <p className="mt-2">
          Guardamos tus datos mientras tu cuenta esté activa. Si eliminás tu cuenta, borramos o
          anonimizamos tus datos personales dentro de un plazo razonable, salvo que la ley nos obligue a
          conservar algún registro (por ejemplo, de pagos).
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">6. Tus derechos</h2>
        <p className="mt-2">
          Podés pedirnos acceder a tus datos, corregirlos, o eliminar tu cuenta y los datos asociados.
          Escribinos a{' '}
          <a href="mailto:admin@flow-pro.online" className="text-primary hover:underline">
            admin@flow-pro.online
          </a>{' '}
          para ejercer cualquiera de estos derechos.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">7. Seguridad</h2>
        <p className="mt-2">
          Tomamos medidas razonables para proteger tus datos (contraseñas encriptadas, conexiones
          cifradas con HTTPS). Ningún sistema es 100% seguro, así que no podemos garantizar protección
          absoluta.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">8. Menores de edad</h2>
        <p className="mt-2">
          FlowPro no está dirigido a menores de edad y no recopilamos a sabiendas datos de menores.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">9. Cambios a esta política</h2>
        <p className="mt-2">
          Podemos actualizar esta política de tanto en tanto. Si hacemos cambios importantes, lo vamos a
          indicar actualizando la fecha al inicio de esta página.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">10. Contacto</h2>
        <p className="mt-2">
          ¿Preguntas sobre esta política? Escribinos a{' '}
          <a href="mailto:admin@flow-pro.online" className="text-primary hover:underline">
            admin@flow-pro.online
          </a>
          .
        </p>
      </section>
    </LegalLayout>
  )
}
