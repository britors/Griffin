pkgname=griffin-music
pkgver=0.1.2
pkgrel=1
pkgdesc='Local music stem separation and practice desktop app'
arch=('x86_64')
url='https://github.com/britors/Griffin'
license=('GPL3')
depends=('gtk3' 'libxss' 'nss' 'alsa-lib' 'libnotify' 'libsecret' 'libcups' 'libxtst' 'libdrm' 'hicolor-icon-theme')
makedepends=('npm')
source=("griffin-music-${pkgver}.tar.gz::https://github.com/britors/Griffin/archive/refs/tags/v${pkgver}.tar.gz")
sha256sums=('SKIP')

build() {
  cd "${srcdir}/Griffin-${pkgver}"
  npm ci --ignore-scripts
  npm run build
  npx electron-builder --linux AppImage --config.directories.output=release
}

package() {
  local appimage
  appimage="$(find "${srcdir}/Griffin-${pkgver}/release" -maxdepth 1 -name '*.AppImage' -print -quit)"
  [[ -n "${appimage}" ]] || { echo 'AppImage não gerado.' >&2; return 1; }
  install -Dm755 "${appimage}" "${pkgdir}/opt/griffin-music/griffin-music.AppImage"
  install -Dm755 /dev/stdin "${pkgdir}/usr/bin/griffin-music" <<'EOF'
#!/bin/sh
exec /opt/griffin-music/griffin-music.AppImage --no-sandbox "$@"
EOF
}
