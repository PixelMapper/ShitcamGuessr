/**
 * main.js
 *
 * Features:
 *  - 5-Runden-Logik (Score)
 *  - Zwei Marker-PNGs (blau/rot), die NICHT mitskalieren
 *  - Overlay-Kasten auf dem KI-Bild
 *  - Platzhalter-Bilder ("Kein Bild" / "Generating...")
 *  - Panning, Zoom, Klick (nur wenn nicht gepanned)
 *  - Ländergrenzen (Polygone) aus /api/countries
 *  - Große Städte (z. B. ab zoomLevel>1.2) aus /api/cities
 */

// ====================== Globale Variablen ======================

// Aktuelle Shitcam-Logik-Daten
let currentCity    = null;        // Stadt-Infos vom Server
let selectedLatLon = null;        // User-Punkt (blauer Marker)
let showCityMarker = false;       // roter Marker erst nach "OK"
let isPanning      = false;       
let hasPanned      = false;
let countries = [];

// Runden & Score
let roundNumber = 0;
let totalScore  = 0;
const maxRounds = 5;

// Canvas & Context
const canvas = document.getElementById('mapCanvas');
const ctx    = canvas.getContext('2d');

// Variable zur Steuerung der Sichtbarkeit von Städten und deren Labels
let showCities = true;
let showCountries = true;

// Pan/Zoom
let offsetX   = 0;
let offsetY   = 0;
let zoomLevel = 1280 / 5400;
let lastPanPos= null;

// Platzhalter-Bilder (Pfad anpassen, falls nötig)
const placeholderNoImage     = "static/images/placeholder_no_image.png";
const placeholderGenerating  = "static/images/placeholder_generating.png";

// Marker-Bilder (bitte Pfade anpassen)
const markerImageBlue = new Image();
markerImageBlue.src   = "static/images/shitcampin_blue.png";

const markerImageRed  = new Image();
markerImageRed.src    = "static/images/shitcampin_red.png";

// Basiskarte (wird skaliert gezeichnet)
const baseMap = new Image();
baseMap.src   = "static/images/world_map.jpg"; // Pfad anpassen
baseMap.onload = function() {
    resetViewAndData();
    drawEverything();
};

// Overlay-Kasten auf dem KI-Bild
const cityOverlay = document.getElementById('cityOverlay');

// ---------------------- Geo-Daten ----------------------

// Hier landen die geladenen Ländergrenzen (GeoJSON) und Städte
let geojsonCountries = null;
let allCities        = [];

/**
 * Lädt die Ländergrenzen und die Liste großer Städte vom Backend.
 * Passe ggf. Endpunkte und Datenstruktur an!
 */
async function loadGeodata() {
    try {
        // Ländergrenzen laden
        const respCountries = await fetch('static/data/countries_shapes.json');
        geojsonCountries    = await respCountries.json(); // GeoJSON FeatureCollection

        // Städte laden
        const respCities = await fetch('static/data/cities.json');
        allCities         = await respCities.json(); // Array von Stadtobjekten

        console.log("Ländergrenzen und Städte geladen.");
        drawEverything();
    } catch (err) {
        console.error("Fehler beim Laden der Geo-Daten:", err);
    }
}

// Rufe loadGeodata() möglichst früh auf
loadGeodata();

/**
 * Lädt die Länder-Daten aus der JSON-Datei
 */
async function loadCountries() {
    try {
        const response = await fetch('static/data/countries.json'); // Passe den Pfad zur JSON-Datei an
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        countries = await response.json();
        console.log(`Länder-Daten geladen: ${countries.length} Länder.`);
        drawEverything(); // Aktualisiert die Zeichnung nach dem Laden der Daten
    } catch (error) {
        console.error("Fehler beim Laden der Länder-Daten:", error);
    }
}

// Rufe die Funktion beim Start auf
loadCountries();

// ====================== Hauptzeichenroutine ======================
function drawEverything() {
    // 1) Canvas löschen
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 2) Karte + Polygone + Städte (im skalierten Modus)
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(zoomLevel, zoomLevel);

    // (a) Basiskarte zeichnen
    ctx.drawImage(baseMap, 0, 0);

    // (b) Ländergrenzen zeichnen
    if (geojsonCountries) {
        drawCountries(geojsonCountries);
        // drawCountryLabels(geojsonCountries); // Zeichne die Ländernamen
    }

    if(showCities) {
        // (c) Städte nur ab gewissem Zoomlevel
        if (zoomLevel > 1.2 && allCities.length > 0) {
            drawCities(allCities);
        }
    }

    ctx.restore();

    // 5) Länder-Namen zeichnen
    if(showCountries) {
        drawCountryLabels();
    }

    // ctx.restore();

    // 3) Marker (Screen Space)
    if (selectedLatLon) {
        drawMarkerScreenSpace(selectedLatLon[0], selectedLatLon[1], markerImageBlue);
    }
    if (showCityMarker && currentCity) {
        const { latitude, longitude } = currentCity;
        drawMarkerScreenSpace(latitude, longitude, markerImageRed);
        // Linie
        if (selectedLatLon) {
            drawLineScreenSpace(selectedLatLon[0], selectedLatLon[1],
                                latitude, longitude,
                                'red');
        }
    }


}

// ====================== Länder zeichnen ======================
function drawCountries(geojson) {
    if (!geojson.features) return;

    ctx.strokeStyle = "gray";
    ctx.lineWidth   = 1 / zoomLevel;

    // Durch Features iterieren
    geojson.features.forEach(feature => {
        const geom = feature.geometry;
        if (!geom) return;

        if (geom.type === "Polygon") {
            drawPolygon(geom.coordinates);
        } else if (geom.type === "MultiPolygon") {
            geom.coordinates.forEach(coords => {
                drawPolygon(coords);
            });
        }
    });
}



/**
 * Zeichnet EIN Polygon (ein Array von Ringen: [ [ [lon, lat], [lon, lat], ... ] ])
 */
function drawPolygon(polygonCoords) {
    // polygonCoords = [outerRing, hole1, hole2, ...]
    ctx.beginPath();
    polygonCoords.forEach(ring => {
        ring.forEach((coord, idx) => {
            const [lon, lat] = coord; // GeoJSON => [lon, lat]
            const [x, y]     = latLonToCanvas(lat, lon);
            if (idx === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.closePath();
    });
    ctx.stroke();
}

// ====================== Städte zeichnen ======================
function drawCities(cityList) {
    // cityList = [{city, latitude, longitude, country, iso2, iso3, capital, population, oid, id}, ...]

    const placedLabelBoxes = [];

    cityList.forEach(city => {
        const { city: cityName, latitude, longitude, population } = city;

        // Bestimme Sichtbarkeit basierend auf Zoom und Population
        if (!isCityVisible(population, zoomLevel)) return;

        const [screen_x, screen_y] = getScreenPosition(latitude, longitude);

        if (!isInViewport(screen_x, screen_y)) return;

        const [pointpos_x, pointpos_y] = latLonToCanvas(latitude, longitude);

        // Punkt zeichnen
        ctx.fillStyle = "white";
        ctx.strokeStyle = "black"
        ctx.lineWidth = 5 / zoomLevel;
        ctx.beginPath();
        ctx.arc(pointpos_x, pointpos_y, 5 / zoomLevel, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.fill();

        // Schriftgröße basierend auf Population
        const fontSize = mapPopulationToFontSize(population) / zoomLevel;
        ctx.font      = `${fontSize}px Arial`;
        ctx.fillStyle = "white";
        ctx.strokeStyle = "black"

        // setup these to match your needs
        ctx.miterLimit = 2;
        ctx.lineJoin = 'circle';

        finalPos = setTextboxAlign(ctx, cityName, pointpos_x, pointpos_y, fontSize, placedLabelBoxes);
        ctx.lineWidth = 5 / zoomLevel;
        // const offsetPos = 7 / zoomLevel;
        ctx.strokeText(cityName, finalPos.x, finalPos.y);
        ctx.fillText(cityName, finalPos.x, finalPos.y);

        ctx.strokeText(cityName, finalPos.x, finalPos.y);
        ctx.fillText(cityName, finalPos.x, finalPos.y);
    });
}

/**
 * Zeichnet die Ländernamen auf der Karte basierend auf labelrank und zoomLevel
 */
function drawCountryLabels() {
    if (!countries || countries.length === 0) return;
    
    countries.forEach(country => {
        const { name, latitude, longitude, labelrank } = country;
        

        // Überprüfe, ob der aktuelle zoomLevel den labelrank erfüllt
        if (zoomLevel*2 < labelrank) return; // Name nicht anzeigen

        // Konvertiere Latitude und Longitude zu Bildschirmkoordinaten
        const [screenX, screenY] = getScreenPosition(latitude, longitude);

        console.log(screenX)

        // Überprüfe, ob die Position im sichtbaren Bereich liegt
        if (!isInViewport(screenX, screenY)) return;

        // Zeichne den Ländernamen
        ctx.font = "28px Helvetica"; // Feste Schriftgröße
        ctx.fillStyle = "gray";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeStyle = "black"
        
        ctx.strokeText(name, screenX, screenY);
        ctx.fillText(name, screenX, screenY);
    });
}


/**
 * Bestimmt, ob eine Stadt basierend auf ihrer Population und dem aktuellen Zoom sichtbar sein soll.
 * @param {number} population - Einwohnerzahl der Stadt
 * @param {number} zoomLevel - Aktueller Zoomlevel
 * @returns {boolean} - Ob die Stadt sichtbar sein soll
 */
function isCityVisible(population, zoomLevel) {
    // Definiere Schwellenwerte für die Population basierend auf Zoomlevel
    // Diese Werte kannst du nach Bedarf anpassen
    if (zoomLevel < 1.2) {
        return population >= 3000000; // Mindestens 1 Mio Einwohner
    } else if (zoomLevel < 7.0) {
        return population >= 2000000;  // Mindestens 500k Einwohner
    } else if (zoomLevel < 30) {
        return population >= 500000;  // Mindestens 500k Einwohner
    } else {
        return population >= 200000;  // Mindestens 500k Einwohner
    }
}

/**
 * Mappt die Population einer Stadt auf eine passende Schriftgröße.
 * Größere Population -> größere Schrift.
 * @param {number} population - Einwohnerzahl der Stadt
 * @returns {number} - Schriftgröße in Pixeln
 */
function mapPopulationToFontSize(population) {
    // // Mappe auf Schriftgröße
    if (population > 2000000) {
        return 25;
    } else if (population > 1000000) {
        return 22;
    } else if (population > 500000) {
        return 18;
    } else {
        return 15;
    }
}

// ====================== Marker und Linie (Screen Space) ======================
/**
 * Berechnet die Bildschirmposition einer Stadt basierend auf Zoom und Pan
 * @param {number} lat - Breitengrad
 * @param {number} lon - Längengrad
 * @returns {Array} - [screenX, screenY] Bildschirm-Koordinaten
 */
function getScreenPosition(lat, lon) {
    const [x, y] = latLonToCanvas(lat, lon);
    const screenX = x * zoomLevel + offsetX;
    const screenY = y * zoomLevel + offsetY;
    return [screenX, screenY];
}


function setTextboxAlign(ctx, cityName, pointpos_x, pointpos_y, fontSize, placedLabelBoxes) {
    // Messen des Textes
    const textMetrics = ctx.measureText(cityName);
    const textWidth = textMetrics.width;
    const textHeight = fontSize; // Einfachheit halber

    // Definiere mögliche Positionen relativ zum Punkt
    const offsetPos = 7 / zoomLevel;
    const positions = [
	{ x: pointpos_x + offsetPos, y: pointpos_y - offsetPos }, // oben rechts
	{ x: pointpos_x - textWidth - offsetPos, y: pointpos_y - offsetPos }, // oben links
	{ x: pointpos_x + offsetPos, y: pointpos_y + textHeight + offsetPos }, // unten rechts
	{ x: pointpos_x - textWidth - offsetPos, y: pointpos_y + textHeight + offsetPos } // unten links
    ];

    let finalPos = null;

    // Versuche, eine Position zu finden, die keine Überlagerung verursacht
    for (let pos of positions) {
        const box = { x: pos.x, y: pos.y - textHeight, width: textWidth, height: textHeight };
        const overlap = placedLabelBoxes.some(existingBox => isOverlapping(box, existingBox));

        if (!overlap) {
            finalPos = pos;
            placedLabelBoxes.push(box); // Markiere diese Box als belegt
            break;
        }
    }

    // Wenn keine freie Position gefunden wurde, verwende die Standardposition
    if (!finalPos) {
        finalPos = positions[0]; // Standard: oben rechts
        const box = { x: finalPos.x, y: finalPos.y - textHeight, width: textWidth, height: textHeight };
        placedLabelBoxes.push(box);
    }

    return finalPos;
}

function drawMarkerScreenSpace(lat, lon, img) {
    if (!img.complete) return;

    // lat/lon -> map-Koords
    const [mapX, mapY] = latLonToCanvas(lat, lon);
    // manuell offset + zoom drauf
    const finalX = offsetX + mapX * zoomLevel;
    const finalY = offsetY + mapY * zoomLevel;

    const w = img.width;
    const h = img.height;
    ctx.drawImage(img, finalX - w/2, finalY - h/2);
}


function drawLineScreenSpace(lat1, lon1, lat2, lon2, color) {
    const [mapX1, mapY1] = latLonToCanvas(lat1, lon1);
    const [mapX2, mapY2] = latLonToCanvas(lat2, lon2);

    const finalX1 = offsetX + mapX1 * zoomLevel;
    const finalY1 = offsetY + mapY1 * zoomLevel;
    const finalX2 = offsetX + mapX2 * zoomLevel;
    const finalY2 = offsetY + mapY2 * zoomLevel;

    ctx.beginPath();
    ctx.moveTo(finalX1, finalY1);
    ctx.lineTo(finalX2, finalY2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.stroke();
}

/**
 * Überprüft, ob sich zwei Rechtecke überlappen
 * @param {Object} box1 - Erstes Rechteck mit {x, y, width, height}
 * @param {Object} box2 - Zweites Rechteck mit {x, y, width, height}
 * @returns {boolean} - True, wenn sich die Rechtecke überlappen, sonst False
 */
function isOverlapping(box1, box2) {
    return !(box1.x + box1.width < box2.x ||
             box1.x > box2.x + box2.width ||
             box1.y + box1.height < box2.y ||
             box1.y > box2.y + box2.height);
}

/**
 * Überprüft, ob ein Punkt innerhalb des Canvas-Bereichs liegt
 * @param {number} screenX - X-Koordinate auf dem Bildschirm
 * @param {number} screenY - Y-Koordinate auf dem Bildschirm
 * @returns {boolean} - True, wenn der Punkt sichtbar ist, sonst False
 */
function isInViewport(screenX, screenY) {
    return screenX >= 0 && screenX <= canvas.width && screenY >= 0 && screenY <= canvas.height;
}


// ====================== Hilfsfunktionen (LatLon <-> Canvas) ======================
function latLonToCanvas(lat, lon) {
    // Passe ggf. die Werte an dein Base-Map-Bild an
    let x = (lon + 180) * (5400 / 360);
    let y = (90 - lat)  * (2700  / 180);
    return [x, y];
}

function canvasToLatLon(x, y) {
    let lon = (x / (5400 / 360)) - 180;
    let lat = 90 - (y / (2700  / 180));
    return [lat, lon];
}

// ====================== Maus-Events (Pan / Zoom / Klick) ======================
canvas.addEventListener('mousedown', (ev) => {
    isPanning = true;
    hasPanned = false;
    lastPanPos= {x: ev.offsetX, y: ev.offsetY};
});

canvas.addEventListener('mousemove', (ev) => {
    if (!isPanning) return;

    let dx = ev.offsetX - lastPanPos.x;
    let dy = ev.offsetY - lastPanPos.y;

    if (dx !== 0 || dy !== 0) {
        hasPanned = true;
    }

    offsetX += dx;
    offsetY += dy;
    lastPanPos = {x: ev.offsetX, y: ev.offsetY};

    drawEverything();
});

canvas.addEventListener('mouseup', (ev) => {
    isPanning = false;

    // Nur wenn wir nicht gepanned haben -> Klick
    if (!hasPanned) {
        let x = (ev.offsetX - offsetX) / zoomLevel;
        let y = (ev.offsetY - offsetY) / zoomLevel;
        let [lat, lon] = canvasToLatLon(x, y);

        selectedLatLon = [lat, lon];
        showCityMarker = false;
        drawEverything();
    }
});

canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    let zoomFactor = 1.1;
    if (ev.deltaY > 0) {
        zoomFactor = 1 / zoomFactor;
    }

    const rect = canvas.getBoundingClientRect();
    let mx = ev.clientX - rect.left;
    let my = ev.clientY - rect.top;

    let wx = (mx - offsetX) / zoomLevel;
    let wy = (my - offsetY) / zoomLevel;

    zoomLevel *= zoomFactor;
    offsetX = mx - wx * zoomLevel;
    offsetY = my - wy * zoomLevel;

    drawEverything();
});

// ====================== Runden & Score (Shitcam-Logik) ======================
function calculateScore(distance) {
    // z. B. 5000 - 0.5*distance
    let rawScore = 5000 - (distance * 0.5);
    if (rawScore < 0) rawScore = 0;
    return Math.floor(rawScore);
}

function startNewGame() {
    roundNumber = 0;
    totalScore  = 0;
}

function resetViewAndData() {
    currentCity    = null;
    selectedLatLon = null;
    showCityMarker = false;
    offsetX        = 0;
    offsetY        = 0;
    zoomLevel      = 1280 / 5400

    document.getElementById('cityImage').src = placeholderNoImage;
    cityOverlay.style.display = "none";
    cityOverlay.innerHTML     = "";

    document.getElementById('btnCalcDist').disabled = false;
    drawEverything();
}

// ====================== Button-Events ======================
document.getElementById('btnNewCity').addEventListener('click', async () => {
    try {
        // OK-Button aktivieren
        document.getElementById('btnCalcDist').disabled = false;

        // Overlay ausblenden
        cityOverlay.style.display = "none";
        cityOverlay.innerHTML     = "";

        // "Generating..."-Platzhalter
        document.getElementById('cityImage').src = placeholderGenerating;

        let resp = await fetch('api/new_city');
        currentCity = await resp.json();

        // Wenn fertig, echtes Bild
        document.getElementById('cityImage').src = currentCity.image;

        // Reset Marker
        selectedLatLon = null;
        showCityMarker = false;

        drawEverything();
    } catch (err) {
        console.error(err);
    }
});

document.getElementById('btnCalcDist').addEventListener('click', async () => {
    if (!currentCity || !selectedLatLon) return;

    // Button deaktivieren
    document.getElementById('btnCalcDist').disabled = true;

    let distData = {
        lat1: currentCity.latitude,
        lon1: currentCity.longitude,
        lat2: selectedLatLon[0],
        lon2: selectedLatLon[1],
    };

    try {
        let resp = await fetch('api/dist', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(distData)
        });
        let data = await resp.json();

        let distance = data.distance;
        let distStr  = distance.toFixed(2) + " km";

        // Roter Marker
        showCityMarker = true;
        drawEverything();

        // Rundenlogik
        roundNumber++;
        let roundPoints = calculateScore(distance);
        totalScore += roundPoints;

        // Overlay-Kasten
        cityOverlay.innerHTML = `
            <strong style="font-size: 1.2em;">${currentCity.city}</strong><br>
            <em>${currentCity.country}</em><br>
            <small>Lat: ${currentCity.latitude.toFixed(2)}, Lon: ${currentCity.longitude.toFixed(2)}</small><br>
            <small>Entfernung: ${distStr}</small><br>
            <small>Runde ${roundNumber} / ${maxRounds}, 
                   Rundenpunkte: ${roundPoints},
                   Gesamt: ${totalScore}</small>
        `;
        cityOverlay.style.display = "block";

        // Letzte Runde?
        if (roundNumber >= maxRounds) {
            setTimeout(() => {
                alert(`Du hast insgesamt ${totalScore} Punkte erreicht!`);
                startNewGame();
                resetViewAndData();
            }, 1000);
        }

    } catch (err) {
        console.error(err);
    }
});

document.getElementById('btnReset').addEventListener('click', () => {
    startNewGame();
    resetViewAndData();
});

// Event Listener für den Toggle-Button
document.getElementById('toggleCitiesBtn').addEventListener('click', () => {
    showCities = !showCities;
    drawEverything();
});

document.getElementById('toggleCountriesBtn').addEventListener('click', () => {
    showCountries = !showCountries;
    drawEverything();
});