pkgname=griffin-music
pkgver=0.1.2
pkgrel=1
pkgdesc='Local music stem separation and practice desktop app'
arch=('x86_64')
url='https://github.com/britors/Griffin'
license=('GPL3')
depends=('gtk3' 'webkit2gtk-4.1' 'libsoup3' 'alsa-lib' 'hicolor-icon-theme')
makedepends=('npm' 'rust' 'cargo' 'pkgconf')
source=("griffin-music-${pkgver}.tar.gz::https://github.com/britors/Griffin/archive/refs/tags/v${pkgver}.tar.gz")
sha256sums=('SKIP')

build() {
  cd "${srcdir}/Griffin-${pkgver}"
  npm ci --ignore-scripts
  npm run build
  npm run package:linux
}

package() {
  local appimage
  appimage="$(find "${srcdir}/Griffin-${pkgver}/src-tauri/target/release/bundle/appimage" -maxdepth 1 -name '*.AppImage' -print -quit)"
  [[ -n "${appimage}" ]] || { echo 'AppImage não gerado.' >&2; return 1; }
  install -Dm755 "${appimage}" "${pkgdir}/opt/griffin-music/griffin-music.AppImage"
  install -Dm755 /dev/stdin "${pkgdir}/usr/bin/griffin-music" <<'EOF'
#!/bin/sh
exec /opt/griffin-music/griffin-music.AppImage "$@"
EOF
}
