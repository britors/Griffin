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

# Prebuilt Tauri bundle — não há símbolos de depuração úteis para extrair.
%global debug_package %{nil}

Name:           griffin-music
Version:        0.1.3
Release:        0
Provides:       griffin = %{version}
Obsoletes:      griffin < %{version}
Summary:        Separação local de stems e prática instrumental
License:        GPL-3.0-only
Group:          Productivity/Multimedia/Sound/Editors and Convertors
URL:            https://github.com/britors/Griffin
Source0:        griffin-%{version}.tar.zst
Source1:        com.w3ti.griffinmusic.desktop
Source2:        LICENSE
Source3:        README.md
ExclusiveArch:  x86_64

BuildRequires:  desktop-file-utils
BuildRequires:  zstd
Requires:       alsa
Requires:       webkit2gtk4.1
Requires:       libsoup-3.0
Requires:       libgtk-3-0
Requires:       libdrm2
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

Este pacote traz o aplicativo Tauri/Rust e baixa os modelos ONNX sob demanda
na primeira execução. Os modelos ficam na pasta de dados do usuário e não
fazem parte do RPM.

%prep
%autosetup -n griffin-%{version}

%build
test -x griffin-music

%install
rm -rf ./resources/models ./models ./src-tauri/models

install -d %{buildroot}%{_libdir}/griffin-music
cp -a . %{buildroot}%{_libdir}/griffin-music/
rm -f %{buildroot}%{_libdir}/griffin-music/chrome-sandbox

install -d %{buildroot}%{_bindir}
cat > %{buildroot}%{_bindir}/griffin-music <<WRAPPER
#!/bin/sh
exec %{_libdir}/griffin-music/griffin-music "\$@"
WRAPPER
chmod 0755 %{buildroot}%{_bindir}/griffin-music

install -Dm0644 %{SOURCE1} %{buildroot}%{_datadir}/applications/com.w3ti.griffinmusic.desktop
install -Dm0644 resources/icon.png %{buildroot}%{_datadir}/icons/hicolor/256x256/apps/com.w3ti.griffinmusic.png
install -Dm0644 %{SOURCE2} %{buildroot}%{_datadir}/licenses/%{name}/LICENSE
install -Dm0644 %{SOURCE3} %{buildroot}%{_docdir}/%{name}/README.md

desktop-file-validate %{buildroot}%{_datadir}/applications/com.w3ti.griffinmusic.desktop

%files
%dir %{_datadir}/licenses/%{name}
%license %{_datadir}/licenses/%{name}/LICENSE
%dir %{_docdir}/%{name}
%doc %{_docdir}/%{name}/README.md
%{_bindir}/griffin-music
%{_libdir}/griffin-music
%{_datadir}/applications/com.w3ti.griffinmusic.desktop
%dir %{_datadir}/icons/hicolor
%dir %{_datadir}/icons/hicolor/256x256
%dir %{_datadir}/icons/hicolor/256x256/apps
%{_datadir}/icons/hicolor/256x256/apps/com.w3ti.griffinmusic.png

%changelog
