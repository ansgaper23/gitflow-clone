import LegalLayout from '../components/legal/LegalLayout.jsx'

// Términos genéricos para un SaaS chico — cubren lo esencial (cuenta, plan gratis, pagos,
// propiedad del código, terceros, responsabilidad) pero NO reemplazan una revisión legal real,
// sobre todo la cláusula de jurisdicción, que queda deliberadamente neutra.
export default function Terms() {
  return (
    <LegalLayout title="Términos de Uso" updated="29 de agosto de 2026">
      <p>
        Estos Términos de Uso regulan el acceso y uso de FlowPro (el "Servicio"), disponible en
        flow-pro.online. Al crear una cuenta o usar el Servicio, aceptás estos términos. Si no estás
        de acuerdo, no uses el Servicio.
      </p>

      <section>
        <h2 className="text-lg font-bold text-text">1. Qué es FlowPro</h2>
        <p className="mt-2">
          FlowPro es una plataforma que te permite describir una aplicación en lenguaje natural y
          usar un agente de inteligencia artificial para generar y modificar el código correspondiente,
          guardado en un repositorio de GitHub a tu nombre. Vos revisás y aprobás cada cambio antes de
          que se aplique.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">2. Cuenta y elegibilidad</h2>
        <p className="mt-2">
          Necesitás una cuenta para usar FlowPro. Sos responsable de mantener la confidencialidad de tus
          credenciales y de toda actividad que ocurra bajo tu cuenta. Debés dar información veraz al
          registrarte.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">3. Prueba gratuita y planes pagos</h2>
        <p className="mt-2">
          Las cuentas nuevas reciben una prueba gratuita de 30 minutos de uso del agente, sin necesidad
          de tarjeta de crédito. Después de eso, seguir usando el agente y publicando cambios requiere
          un plan activo. Los planes se venden por duración fija (por ejemplo, 1, 7, 15, 30 o 90 días) y
          no se renuevan automáticamente — no vas a recibir un cargo que no iniciaste vos mismo. Los
          pagos se procesan a través de Stripe; FlowPro no almacena los datos de tu tarjeta.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">4. Propiedad del código y del contenido</h2>
        <p className="mt-2">
          El código generado para tus proyectos se guarda en un repositorio de GitHub de tu propiedad
          (o al que vos le diste acceso a FlowPro). Vos sos dueño de ese código y podés usarlo, exportarlo
          o seguir editándolo fuera de FlowPro en cualquier momento, con o sin una cuenta activa.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">5. Uso aceptable</h2>
        <p className="mt-2">No podés usar FlowPro para:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Generar o distribuir malware, contenido ilegal, o material que infrinja derechos de terceros.</li>
          <li>Intentar vulnerar, sobrecargar o acceder sin autorización a la infraestructura del Servicio.</li>
          <li>Usar el agente de IA para actividades fraudulentas o que violen la ley aplicable.</li>
          <li>Revender o redistribuir el acceso al Servicio sin autorización expresa.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">6. Servicios de terceros</h2>
        <p className="mt-2">
          FlowPro se apoya en servicios de terceros para funcionar: GitHub (repositorios y autenticación),
          Google (autenticación opcional), Stripe (pagos), Supabase (base de datos), y distintos
          proveedores de modelos de IA para generar código y respuestas. El uso de esas integraciones
          también está sujeto a los términos de cada proveedor. FlowPro no controla ni es responsable
          por la disponibilidad o el comportamiento de esos servicios externos.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">7. Disponibilidad del Servicio</h2>
        <p className="mt-2">
          FlowPro se ofrece "tal cual" y "según disponibilidad". Hacemos lo posible por mantener el
          Servicio funcionando de forma estable, pero no garantizamos que esté libre de interrupciones,
          errores, o que el resultado generado por la IA sea siempre correcto — revisá y probá siempre
          los cambios antes de publicarlos.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">8. Limitación de responsabilidad</h2>
        <p className="mt-2">
          En la máxima medida permitida por la ley, FlowPro no será responsable por daños indirectos,
          incidentales o consecuentes derivados del uso del Servicio, incluyendo pérdida de datos,
          ingresos o negocio.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">9. Cancelación</h2>
        <p className="mt-2">
          Podés dejar de usar FlowPro cuando quieras. Como los planes son de duración fija y sin
          renovación automática, no hay un proceso de "cancelación" de suscripción — simplemente no
          renovás. Nos reservamos el derecho de suspender cuentas que violen estos términos.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">10. Cambios a estos términos</h2>
        <p className="mt-2">
          Podemos actualizar estos Términos de Uso de tanto en tanto. Si hacemos cambios importantes, lo
          vamos a indicar actualizando la fecha al inicio de esta página.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">11. Ley aplicable</h2>
        <p className="mt-2">
          Estos términos se rigen por la legislación aplicable en la jurisdicción donde opera FlowPro,
          sin perjuicio de las normas de protección al consumidor que puedan corresponderte según tu
          país de residencia.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-text">12. Contacto</h2>
        <p className="mt-2">
          ¿Preguntas sobre estos términos? Escribinos a{' '}
          <a href="mailto:admin@flow-pro.online" className="text-primary hover:underline">
            admin@flow-pro.online
          </a>
          .
        </p>
      </section>
    </LegalLayout>
  )
}
