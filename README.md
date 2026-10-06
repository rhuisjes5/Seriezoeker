# Seriezoeker

Mobiele webapp die series zoekt via TMDB, een lokale importlijst bewaart en deze direct via wifi naar Serie Manager kan versturen. Scan de pairing-QR live vanuit de app met `Scan QR`; JSON-export blijft beschikbaar als fallback.

## Starten op je pc

Start Serie Manager en kies op het tabblad Serie **Koppel telefoon**. De eerste keer scan je QR 1 met de standaard camera-app van je telefoon, download je het CA-certificaat en installeer je dit als CA-certificaat in Android. Controleer voor installatie of de SHA-256-fingerprint overeenkomt met Serie Manager. Open daarna de beveiligde Seriezoeker-link op de setup-pagina, sta cameratoegang toe en scan QR 2 met **Scan QR** in de app. Beide apparaten moeten op hetzelfde wifi-netwerk zitten. Je kunt de PWA ook los bekijken met een statische server:

```powershell
python -m http.server 8765 --bind 0.0.0.0
```

Open `http://localhost:8765` op de pc voor een losse preview. Direct versturen werkt alleen via de QR-link die Serie Manager toont.

Serie Manager serveert de PWA en import-API via HTTPS met een lokale CA. De installatiestap is nodig omdat de telefoon die CA eerst moet vertrouwen; het CA-certificaat en de SHA-256-fingerprint worden via de setup-pagina en het desktopvenster getoond. De lokale CA-sleutel staat in de Windows-gebruikersmap `%LOCALAPPDATA%\SerieManager\mobile-bridge`. De HTTP-setupserver biedt alleen de CA-download en installatiepagina aan; PWA en API zijn HTTPS. `Scan QR` gebruikt de live camera in de PWA; er is geen aparte scanner-app of internetverbinding voor QR-decodering nodig. De decoder wordt lokaal meegeleverd en gecachet. De decoder is jsQR 1.4.0 onder Apache-2.0; de licentie staat in `qr-decoder-LICENSE.txt`. De TMDB-sleutel wordt lokaal in de browser bewaard en staat niet in exports.

## Overal gebruiken met GitHub Pages

De PWA kan onafhankelijk van Serie Manager als openbare statische site worden gehost. Maak daarvoor een aparte openbare GitHub-repository met alleen de inhoud van deze map; publiceer niet de volledige Serie Manager-workspace. De workflow in `.github/workflows/pages.yml` publiceert alleen de PWA-bestanden. Kies in GitHub bij **Settings > Pages** als bron **GitHub Actions**. Na de eerste push naar `main` staat de site op `https://<gebruikersnaam>.github.io/<repository>/`.

Eenmalig vanuit deze map:

```powershell
git init -b main
git add .
git commit -m "Publish Seriezoeker PWA"
git remote add origin https://github.com/<gebruikersnaam>/<repository>.git
git push -u origin main
```

De site en bronbestanden van deze aparte repository zijn openbaar. Er staat geen TMDB-sleutel in de broncode; de sleutel en importlijst blijven lokaal op de telefoon. Thuis open je steeds dezelfde Pages-site en scan je vanuit de PWA de koppel-QR van Serie Manager. Sta cameratoegang en, wanneer Chrome erom vraagt, toegang tot het lokale netwerk toe. Direct versturen werkt alleen wanneer de telefoon thuis op hetzelfde netwerk zit als de pc en Serie Manager draait.

## Naar Serie Manager

Na het koppelen kies je `Verstuur direct naar Serie Manager`. Nieuwe series worden toegevoegd; bestaande records worden overgeslagen. Serie Manager vraagt of NAS-mappen, seizoensmappen en het juiste Q-DIR-bestand moeten worden aangemaakt, en controleert ook overgeslagen records op ontbrekende mappen. De PWA gebruikt TMDB-posters alleen als thumbnails en laat het veld `Afbeelding` leeg, zodat Serie Manager je TVDB-banner niet door een TMDB-still vervangt. `Exporteer JSON` en `Importeer telefoonlijst` blijven beschikbaar als fallback.