# Video Audio DL

App web para descargar video MP4 o audio MP3 desde una URL pública. `yt-dlp` y `ffmpeg` se ejecutan dentro del contenedor del servidor; el dispositivo del usuario solo necesita un navegador.

## Iniciar la app web

Requisitos del servidor: Docker Engine y Docker Compose v2. El contenedor necesita soporte de `iptables`/`ip6tables` y permite `NET_ADMIN` para limitar las conexiones salientes a destinos públicos.

```sh
docker compose up --build -d
```

Abre <http://localhost:3000>. La publicación de puerto queda ligada a `127.0.0.1` por defecto. Para acceder desde Internet, coloca la app detrás de un proxy HTTPS con autenticación y límites de acceso; la app no incluye cuentas de usuario.

El contenedor incorpora `yt-dlp` 2026.08.19 y `ffmpeg` 7:5.1.9-0+deb12u1. El archivo [Dockerfile](Dockerfile) fija ambas versiones. El servicio acepta dos descargas simultáneas, limita cada trabajo a una hora, conserva archivos listos durante 15 minutos y los guarda en un volumen temporal de hasta 2 GB. Estos valores se configuran en [compose.yaml](compose.yaml).

Para detener el servicio:

```sh
docker compose down
```

## Descarga desde la terminal

Los lanzadores existentes siguen disponibles y guardan el archivo en el Escritorio.

### Windows

Haz doble clic en `descargar_windows.bat` o ejecuta:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\descargar_windows.ps1"
```

### macOS

Haz doble clic en `descargar_macos.command`.

Los lanzadores locales requieren `yt-dlp` en PATH y `ffmpeg` para audio MP3.
