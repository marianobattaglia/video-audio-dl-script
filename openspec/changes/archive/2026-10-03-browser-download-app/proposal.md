# Proposal

## Why

Hoy hace falta instalar `yt-dlp` en el equipo y `ffmpeg` para obtener MP3 antes de usar los scripts del proyecto. Una app de navegador permitirá pegar una URL, elegir video o audio y recibir el archivo sin instalar esas herramientas en el equipo del usuario.

## What Changes

- Añadir una interfaz web para enviar una URL y elegir una descarga de video MP4 o audio MP3.
- Añadir un servicio de descarga que ejecute la lógica y opciones de los scripts existentes, informe el progreso y entregue el archivo al navegador.
- Preparar el despliegue del servicio con `yt-dlp` y `ffmpeg` disponibles en el entorno servidor, aislando esos requisitos del dispositivo del usuario.
- Validar entradas y presentar errores de descarga de forma comprensible.

## Capabilities

### New Capabilities

- `browser-downloader`: Descarga de video o audio desde una URL mediante una app web y entrega del archivo al navegador.

### Modified Capabilities

Ninguna.

## Impact

- Scripts actuales `descargar_windows.ps1` y `descargar_macos.command`: sus opciones de formato, calidad y extractor sirven de referencia; su interacción por terminal y destino fijo al Escritorio no encajan directamente en una solicitud web.
- Nuevo frontend y backend web, más la configuración de despliegue para `yt-dlp` y `ffmpeg` en el servidor.
- El alcance inicial presupone URLs públicas y que la app se sirve desde un entorno que puede ejecutar ambos binarios. El usuario descarga el resultado desde su navegador; no se presupone acceso a cookies del perfil local.
