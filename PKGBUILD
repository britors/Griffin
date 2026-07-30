pkgname=griffin-music
pkgver=0.1.0
pkgrel=1
pkgdesc='Local music stem separation and practice desktop app'
arch=('x86_64')
url='https://github.com/w3ti/griffin-music'
license=('MIT')
depends=('gtk3' 'libxss' 'nss' 'alsa-lib')
source=("griffin-music-${pkgver}.tar.gz::https://github.com/w3ti/griffin-music/archive/refs/tags/v${pkgver}.tar.gz")
sha256sums=('SKIP')

package() {
  install -Dm644 "${srcdir}/griffin-music-${pkgver}/release/Griffin Music-${pkgver}.AppImage" "${pkgdir}/opt/griffin-music/griffin-music.AppImage"
  install -Dm755 /dev/stdin "${pkgdir}/usr/bin/griffin-music" <<'EOF'
#!/bin/sh
exec /opt/griffin-music/griffin-music.AppImage --no-sandbox "$@"
EOF
}
