// Initialize Map Function
function initMap(containerId, locations, routesData) {
  if (!document.getElementById(containerId)) return;

  // Default view
  const map = L.map(containerId).setView([22.55, 114.54], 12);

  // Add Tile Layer (OpenStreetMap)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  // Add Markers
  const markers = [];
  locations.forEach(loc => {
    const marker = L.marker(loc.coords).addTo(map);

    // Create Amap link (Amap uses lng,lat)
    const amapUrl = `https://uri.amap.com/marker?position=${loc.coords[1]},${loc.coords[0]}&name=${encodeURIComponent(loc.name)}`;

    const popupContent = `
            <div style="text-align: center;">
                <strong>${loc.name}</strong><br>
                <span style="font-size: 0.8rem; color: #666;">${loc.day || ''}</span><br>
                ${loc.desc}<br>
                <a href="${amapUrl}" target="_blank" style="display: inline-block; margin-top: 5px; color: #3498db; text-decoration: none; font-size: 0.8rem;">
                    <i class="fas fa-location-arrow"></i> 导航
                </a>
            </div>
        `;

    marker.bindPopup(popupContent);
    markers.push(marker);
  });

  // Fit bounds to show all markers
  if (markers.length > 0) {
    const group = new L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.1));
  }

  // Add route lines
  if (routesData) {
    routesData.forEach(route => {
      L.polyline(route.path, { color: route.color || 'blue', dashArray: '5, 10' }).addTo(map);
    });
  }
}
