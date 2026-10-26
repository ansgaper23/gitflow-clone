# Arquitectura de Infraestructura: FlowPro

Este documento detalla la arquitectura de servidores, el balanceo de carga y los procedimientos de despliegue para la plataforma FlowPro. 
Cualquier Inteligencia Artificial o Ingeniero DevOps que asuma el mantenimiento del proyecto debe leer cuidadosamente esta configuración antes de realizar modificaciones en el entorno de producción.

---

## 1. Topología de Servidores

Actualmente, la plataforma está dividida en un Clúster de dos nodos:

### Nodo 1: Servidor Principal (Maestro)
- **IP:** `130.51.22.140`
- **Rol:** Nodo principal, orquestador de compilaciones, proxy inverso global y servidor de bases de datos.
- **Componentes que ejecuta:**
  - **Nginx:** Actúa como Proxy Inverso global. Sirve el Frontend estático y balancea las peticiones de la API.
  - **Frontend (Vite/React):** Los archivos estáticos ubicados en `/opt/gitflow-app/frontend/dist`. Solo existen en esta máquina.
  - **PostgreSQL (Base de Datos):** Escucha en `127.0.0.1:5432`. Solo accesible internamente.
  - **PowerDNS (API):** Escucha en `127.0.0.1:8081`. Solo accesible internamente.
  - **Orquestador de Previews:** Escucha en `127.0.0.1:4000`. Consume la mayor parte de la RAM al ejecutar `npm install` y `npm run dev` para los proyectos de los usuarios.
  - **Backend API (Instancia Local):** Node.js corriendo con PM2 en el puerto `8787`.

### Nodo 2: Servidor Secundario (Réplica / Balanceador)
- **IP:** `152.67.42.24` (1GB RAM)
- **Rol:** Réplica de la API (Backend) para aligerar la carga de WebSockets, procesamiento de chats y validaciones.
- **Componentes que ejecuta:**
  - **Backend API (Instancia Réplica):** Node.js corriendo con PM2 (`/opt/gitflow-app/backend/src/index.js`).
  - **Túnel SSH (Autossh):** Mantiene una conexión persistente encriptada con el Nodo 1.

---

## 2. Configuración del Túnel SSH y Red Segura

Dado que las bases de datos en el Nodo 1 están bloqueadas por cortafuegos (solo escuchan en `127.0.0.1` por seguridad), el Nodo 2 no puede conectarse a ellas mediante una IP pública.

Para solucionar esto, el Nodo 2 ejecuta un servicio de **Systemd (`flowpro-tunnel.service`)** que usa `autossh`. 
Este túnel hace dos cosas vitales:
1. **Local Port Forwarding (-L):** Mapea los puertos remotos del Nodo 1 (PostgreSQL, DNS, Orquestador) a los puertos locales del Nodo 2. Así, cuando el Backend en el Nodo 2 intenta conectarse a `127.0.0.1:5432`, el túnel redirige silenciosamente esa petición a la base de datos en el Nodo 1.
2. **Remote Port Forwarding (-R):** Toma el puerto de la API del Nodo 2 y lo expone en el Nodo 1 bajo el puerto `8788`. De esta forma, Nginx (en el Nodo 1) puede enviar tráfico al Nodo 2 simplemente apuntando a `127.0.0.1:8788`.

*Nota:* No es necesario abrir ningún puerto adicional en los cortafuegos (UFW/Iptables) gracias a este diseño.

---

## 3. Balanceo de Carga (Nginx)

El archivo de configuración de Nginx (`/etc/nginx/sites-enabled/gitflow`) en el Nodo 1 cuenta con un bloque *Upstream* que distribuye el tráfico equitativamente:

```nginx
upstream backend_api {
    server 127.0.0.1:8787; # Instancia del Backend en el Nodo Principal
    server 127.0.0.1:8788; # Instancia del Backend en el Nodo 2 (a través del túnel)
}

location /api/ {
    proxy_pass http://backend_api;
    # ...
}
```

Si el Backend de alguno de los nodos colapsa, Nginx enrutará todo el tráfico de forma automática hacia el nodo sobreviviente (Alta Disponibilidad).

---

## 4. Guía de Despliegues (Deployments)

Al generar nuevas actualizaciones en el código de FlowPro, el Ingeniero o IA debe seguir estas reglas estrictas:

### A. Cambios Visuales (Frontend)
Si se modifican archivos dentro de `/frontend/src/...`:
1. Ejecutar `npm run build` para compilar el código.
2. Subir la carpeta `dist` **únicamente al Nodo 1** (`130.51.22.140`) en la ruta `/opt/gitflow-app/frontend/dist`.
3. No se requiere reiniciar ningún servicio ni tocar el Nodo 2.

### B. Cambios de Lógica (Backend)
Si se modifican archivos dentro de `/backend/src/...`:
1. Subir los archivos modificados al **Nodo 1** (`/opt/gitflow-app/backend/`).
2. Subir los archivos modificados al **Nodo 2** (`/opt/gitflow-app/backend/`).
3. Ejecutar `pm2 restart backend` **en ambos nodos** para aplicar los cambios.

### C. Cambios en el Orquestador
El orquestador (`previewOrchestrator.js` u otros componentes pesados de clonación) solo existe operativamente en el **Nodo 1**, ya que es la única máquina con RAM suficiente para compilar paquetes NPM de usuarios.

---

## 5. Mantenimiento y Troubleshooting

- **Si el Nodo 2 no recibe conexión a la Base de Datos:** Verificar que el túnel SSH esté corriendo en el Nodo 2: `sudo systemctl status flowpro-tunnel`.
- **Si se reinicia el Nodo 1:** El Nodo 2 intentará reconectarse automáticamente gracias a `autossh`, pero puede tardar hasta 60 segundos en restaurar la conexión tras el reinicio.
