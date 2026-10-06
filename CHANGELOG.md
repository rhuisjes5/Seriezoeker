# Changelog - Seriezoeker PWA

## [2026-10-06]

### ✨ Nieuw
- **Live QR-scanner in de app**: Koppel-QR-codes worden met de camera in de PWA gescand; de decoder wordt lokaal meegeleverd en vereist geen externe scanner-app of CDN.
- **GitHub Pages-deployment**: Een workflow publiceert alleen de PWA-bestanden, zodat Seriezoeker overal via HTTPS beschikbaar kan zijn.
- **Bevestigen vóór koppelen**: Na het herkennen van de koppel-QR start de verbinding pas na een tik op `Verbinden met Serie Manager`. Dit geeft Chrome gelegenheid om toestemming voor lokaal netwerk te vragen.
- **NAS- en Q-DIR-vraag na import**: Serie Manager vraagt voor nieuwe PWA-importen of de bijbehorende mappen en het juiste Q-DIR-bestand moeten worden aangemaakt. Ook overgeslagen bestaande records worden op ontbrekende mappen gecontroleerd. De PWA stuurt TMDB-status en seizoenen mee voor de juiste lopend/beëindigd-keuze.

### 🔧 Verbeteringen en fixes
- **Lokale verbinding met Serie Manager**: De PWA controleert de pairing-token via de HTTPS-bridge. Rechtstreeks versturen werkt wanneer telefoon en pc op hetzelfde netwerk zitten en Serie Manager draait.
- **TVDB-banners behouden**: De PWA gebruikt TMDB-posters alleen voor thumbnails en laat `Afbeelding` leeg bij import. Oude TMDB-afbeeldingslinks in de nog niet verstuurde telefoonlijst worden verwijderd.
- **TVDB-serielinks gebruiken slugs**: Links gebruiken nu de serienaam in het URL-pad, bijvoorbeeld `/series/beverly-hills-90210`, in plaats van een numeriek ID dat een 404 gaf. Bestaande wachtrijlinks worden automatisch omgezet.
- **Duidelijkere verbindingsfout**: Een mislukte verbinding noemt nu de belangrijkste controles voor lokaal netwerk, certificaat, wifi en Windows Firewall.
- **Lokale QR-decoder offline beschikbaar**: jsQR 1.4.0 is gebundeld onder Apache-2.0; de licentie staat in `qr-decoder-LICENSE.txt`.
- **Beëindigde series krijgen status 2**: De PWA zet nieuwe en eerder bewaarde wachtrij-items op status `2` op basis van TMDB-status en `in_production`. Ontbrekende TMDB-details worden vóór verzending opgehaald; de bridge corrigeert ook bestaande records.
- **Status direct zichtbaar in Serie Manager**: De desktopapp ververst na import onmiddellijk de geopende serie en de serielijst; wisselen van serie is niet meer nodig.
