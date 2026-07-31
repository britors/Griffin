#
# spec file for package griffin
#
# Copyright (c) 2026 Rodrigo Brito
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#

# Prebuilt Electron bundle (chromium, node_modules nativos, modelos ONNX
# fp16 já baixados) — não há símbolos de depuração úteis para extrair, e
# tentar processá-los deixa o build desnecessariamente lento.
%global debug_package %{nil}

Name:           griffin
Version:        0.1.0
Release:        0
Summary:        Separação local de stems e prática instrumental
License:        GPL-3.0-only
Group:          Productivity/Multimedia/Sound/Editors and Convertors
URL:            https://github.com/britors/Griffin
Source0:        %{name}-%{version}.tar.zst
Source1:        com.w3ti.griffinmusic.desktop
ExclusiveArch:  x86_64

BuildRequires:  desktop-file-utils
BuildRequires:  zstd
Requires:       alsa
Requires:       libXss1
Requires:       libXtst6
Requires:       libatk-bridge-2_0-0
Requires:       libcups2
Requires:       libdrm2
Requires:       libgtk-3-0
Requires:       libnotify4
Requires:       libsecret-1-0
Requires:       mozilla-nss
Requires:       hicolor-icon-theme

%description
Griffin Music é o aplicativo desktop standalone da W3TI para separação
local de stems e prática instrumental. O áudio permanece no computador:
não há servidor próprio nem upload de faixas.

Separa vocal, bateria, baixo e outros com o modelo ONNX htdemucs_ft (perfil
opcional de seis stems para guitarra/violão combinados e piano), com player
sincronizado ao mixer (mute/solo, pitch, tempo, loop A-B), projetos,
favoritos, BPM/tonalidade/afinação/acordes/letras e exportação de mixagens e
stems individuais em WAV.

Este pacote traz o Electron e os modelos ONNX (htdemucs_ft) já embutidos;
não é necessário acesso à rede após a instalação para o perfil padrão de
quatro stems.

%prep
%autosetup

%build
test -x griffin-music

%install
# electron-builder inclui no pacote do onnxruntime-node os binários de todas
# as plataformas suportadas. Para este RPM x86_64, manter os diretórios
# darwin, win32 e linux/arm64 faz o gerador automático de dependências do RPM
# descobrir ld-linux-aarch64.so.1 e tornar o pacote instalável apenas em
# sistemas que forneçam o loader ARM.
find . -type d \( \
    -path '*/onnxruntime-node/bin/napi-*/darwin' -o \
    -path '*/onnxruntime-node/bin/napi-*/win32' -o \
    -path '*/onnxruntime-node/bin/napi-*/linux/arm64' \
\) -prune -exec rm -rf -- {} +

install -d %{buildroot}%{_libdir}/griffin-music
cp -a . %{buildroot}%{_libdir}/griffin-music/
rm -f %{buildroot}%{_libdir}/griffin-music/{LICENSE,README.md,chrome-sandbox}

install -d %{buildroot}%{_bindir}
cat > %{buildroot}%{_bindir}/griffin-music <<WRAPPER
#!/bin/sh
# O chrome-sandbox setuid não é empacotado; --no-sandbox evita depender de
# um binário setuid-root dentro do RPM.
exec %{_libdir}/griffin-music/griffin-music --no-sandbox "\$@"
WRAPPER
chmod 0755 %{buildroot}%{_bindir}/griffin-music

install -Dm0644 %{SOURCE1} %{buildroot}%{_datadir}/applications/com.w3ti.griffinmusic.desktop
install -Dm0644 resources/icon.png %{buildroot}%{_datadir}/icons/hicolor/256x256/apps/com.w3ti.griffinmusic.png

desktop-file-validate %{buildroot}%{_datadir}/applications/com.w3ti.griffinmusic.desktop

%files
%license LICENSE
%doc README.md
%{_bindir}/griffin-music
%{_libdir}/griffin-music
%{_datadir}/applications/com.w3ti.griffinmusic.desktop
%dir %{_datadir}/icons/hicolor
%dir %{_datadir}/icons/hicolor/256x256
%dir %{_datadir}/icons/hicolor/256x256/apps
%{_datadir}/icons/hicolor/256x256/apps/com.w3ti.griffinmusic.png

%changelog
