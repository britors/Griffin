pkgname=griffin-music
pkgver=3.0.1
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
  local root="${srcdir}/Griffin-${pkgver}"
  install -Dm755 "${root}/src-tauri/target/release/griffin-music" \
    "${pkgdir}/usr/bin/griffin-music"
  install -Dm755 "${root}/src-tauri/target/release/griffin-onnx-worker" \
    "${pkgdir}/usr/bin/griffin-onnx-worker"
  for provider in libonnxruntime_providers_cuda.so libonnxruntime_providers_shared.so; do
    if [[ -f "${root}/src-tauri/target/release/${provider}" ]]; then
      install -Dm755 "${root}/src-tauri/target/release/${provider}" \
        "${pkgdir}/usr/bin/${provider}"
    fi
  done
  install -Dm644 "${root}/packaging/com.w3ti.griffinmusic.desktop" \
    "${pkgdir}/usr/share/applications/com.w3ti.griffinmusic.desktop"
  install -Dm644 "${root}/resources/32x32.png" \
    "${pkgdir}/usr/share/icons/hicolor/32x32/apps/griffin-music.png"
  install -Dm644 "${root}/resources/128x128.png" \
    "${pkgdir}/usr/share/icons/hicolor/128x128/apps/griffin-music.png"
  install -Dm644 "${root}/resources/256x256.png" \
    "${pkgdir}/usr/share/icons/hicolor/256x256/apps/griffin-music.png"
}
