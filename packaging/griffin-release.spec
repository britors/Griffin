Name:           griffin-music
Version:        %{version}
Release:        1
Summary:        Separação local de stems e prática instrumental
License:        GPL-3.0-only
URL:            https://github.com/britors/Griffin
BuildArch:      x86_64
Provides:       griffin = %{version}
Obsoletes:      griffin < %{version}
# CUDA is optional: if its runtime is absent, the worker must still install
# and fall back to CPU instead of making the whole package uninstallable.
%global __requires_exclude_from ^%{_bindir}/libonnxruntime_providers_.*\.so$
Requires:       alsa
Requires:       webkit2gtk4.1
Requires:       libsoup-3.0
Requires:       libgtk-3-0
Requires:       libdrm2
Requires:       hicolor-icon-theme

%description
Griffin Music é um aplicativo desktop para separação local de stems e prática
instrumental. Os modelos ONNX são baixados sob demanda pelo aplicativo.

%prep

%build

%install
root="%{_griffin_root}"
install -Dm755 "${root}/src-tauri/target/release/griffin-music" \
  "%{buildroot}%{_bindir}/griffin-music"
install -Dm755 "${root}/src-tauri/target/release/griffin-onnx-worker" \
  "%{buildroot}%{_bindir}/griffin-onnx-worker"
for provider in libonnxruntime_providers_cuda.so libonnxruntime_providers_shared.so; do
  if test -f "${root}/src-tauri/target/release/${provider}"; then
    install -Dm755 "${root}/src-tauri/target/release/${provider}" \
      "%{buildroot}%{_bindir}/${provider}"
  fi
done
install -Dm644 "${root}/packaging/com.w3ti.griffinmusic.desktop" \
  "%{buildroot}%{_datadir}/applications/com.w3ti.griffinmusic.desktop"
for size in 32 128 256; do
  install -Dm644 "${root}/resources/${size}x${size}.png" \
    "%{buildroot}%{_datadir}/icons/hicolor/${size}x${size}/apps/griffin-music.png"
done

%files
%{_bindir}/griffin-music
%{_bindir}/griffin-onnx-worker
%{_bindir}/libonnxruntime_providers_*.so
%{_datadir}/applications/com.w3ti.griffinmusic.desktop
%{_datadir}/icons/hicolor/*/apps/griffin-music.png
