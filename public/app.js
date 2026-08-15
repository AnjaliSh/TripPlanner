// public/app.js — vanilla JS, no build step, no dependencies (Leaflet is
// the one exception, loaded via <script> tag in index.html for the map tab).

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Skip registration on localhost — the whole point of the service worker
// is caching the app shell for production visitors; in local dev it just
// serves stale HTML/CSS/JS after every edit until you manually clear it
// (caches.keys().forEach(...) + reload), which wastes real time chasing
// "why didn't my change show up" during active development.
const isLocalDev = ["localhost", "127.0.0.1"].includes(location.hostname);
if ("serviceWorker" in navigator && !isLocalDev) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[tripsy] service worker registration failed:", err.message);
    });
  });
} else if ("serviceWorker" in navigator && isLocalDev) {
  // Also unregister any SW a previous visit here left behind, so a tab that
  // was open before this change (or before switching branches) doesn't
  // keep serving a cached shell either.
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
}

async function api(path, options) {
  const res = await fetch(`/api/${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// ---------- Tabs ----------
let mapInstance = null;

$$("nav.tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$("nav.tabs button").forEach((b) => b.classList.remove("active"));
    $$("section.panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`#${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "map" && mapInstance) {
      // Leaflet needs a nudge after being unhidden, or it renders at 0x0 —
      // and a fitBounds() computed earlier while the container was hidden
      // (e.g. at boot, before this tab was ever opened) leaves the map on
      // a nonsensical center/zoom that invalidateSize() alone won't fix,
      // so re-fit against the current markers too.
      setTimeout(() => {
        mapInstance.invalidateSize();
        renderMapMarkers(lastSuggestions);
      }, 50);
    }
    if (btn.dataset.tab === "suggestions") {
      // Re-fetch every visit, not just at boot — cheap no-op on a cache hit
      // server-side, but this is what makes a profile edit made elsewhere
      // in the app show up here without a full page reload.
      loadSuggestions();
    }
  });
});

// ---------- Long Weekend Radar ----------
async function loadRadar() {
  const el = $("#radar-list");
  try {
    const { longWeekends } = await api("long-weekends");
    if (longWeekends.length === 0) {
      el.innerHTML = `<p class="muted">No long weekends found in the next 18 months.</p>`;
      return;
    }
    el.innerHTML = longWeekends
      .map((lw) => {
        const hot = lw.windowIsOpenNow;
        const statusPill = hot
          ? `<span class="pill warn">Window open now</span>`
          : lw.daysUntilWindowOpens > 0
          ? `<span class="pill">Opens in ${lw.daysUntilWindowOpens}d</span>`
          : `<span class="pill">Trip passed</span>`;
        return `
          <div class="ticket ${hot ? "hot" : ""}">
            <div class="ticket-body">
              <h3>${lw.label}</h3>
              <p class="ticket-dates">${lw.startDate} → ${lw.endDate} · ${lw.lengthDays} days</p>
              ${statusPill}
              <p class="muted" style="margin-top:8px;">Planning window opens ${lw.planningWindowOpens}</p>
            </div>
            <div class="ticket-stub">in<br/>${lw.daysUntilTrip}d</div>
          </div>`;
      })
      .join("");
  } catch (err) {
    el.innerHTML = `<div class="error-banner">Couldn't load long weekends: ${err.message}</div>`;
  }
}

// ---------- Suggestions ----------
let lastSuggestions = [];

function matchBadgeClass(match) {
  const ratio = match.score / match.total;
  if (ratio >= 0.8) return "";
  if (ratio >= 0.5) return "partial";
  return "low";
}

// generateSuggestions (lib/ai.js) is search-grounded and can take up to
// ~20-30s on a cache miss, unlike the old instant static list — and
// clicking the Suggestions tab now re-fetches every time (see the nav
// click handler below) so the list picks up profile edits without a full
// page reload. Guard against a double-fetch: bootApp() already calls this
// once at boot, and a tab click during that first fetch would otherwise
// fire a second concurrent (and, on a cache miss, AI-billed) request.
let suggestionsInFlight = null;

function loadSuggestions() {
  if (suggestionsInFlight) return suggestionsInFlight;
  suggestionsInFlight = loadSuggestionsInner().finally(() => {
    suggestionsInFlight = null;
  });
  return suggestionsInFlight;
}

async function loadSuggestionsInner() {
  const el = $("#suggestions-list");
  const meta = $("#suggestions-meta");
  el.innerHTML = `<p class="muted">Researching destinations for your profile — this can take up to 20-30s the first time…</p>`;
  try {
    const { suggestions, hiddenCount, personalized } = await api("suggestions");
    lastSuggestions = suggestions;
    if (hiddenCount > 0) {
      meta.textContent = `Showing ${suggestions.length} destinations, best fit first · ${hiddenCount} hidden because they're in your visited list.`;
    } else if (personalized) {
      meta.textContent = `Showing ${suggestions.length} destinations personalized to your profile.`;
    } else {
      meta.textContent = `Showing ${suggestions.length} curated destinations — add ANTHROPIC_API_KEY on this deployment to personalize this list to your own profile.`;
    }
    el.innerHTML = suggestions
      .map((d) => {
        const bgStyle = d.image
          ? `style="background-image: linear-gradient(180deg, rgba(15,23,32,0.45) 0%, rgba(15,23,32,0.75) 55%, rgba(15,23,32,0.88) 100%), url('${d.image.imageUrl}')"`
          : "";
        return `
        <div class="dest-card ${d.image ? "has-photo" : ""}" data-id="${d.id}" ${bgStyle}>
          <div class="dest-head">
            <h3>${d.name}, ${d.country}</h3>
            <span class="dest-code">${d.airportCode}</span>
          </div>
          <div class="dest-body">
            <span class="match-badge ${matchBadgeClass(d.match)}">${d.match.score}/${d.match.total} profile fit</span>
            <p class="muted">${d.flightTimeFromHome} flight · ${d.budgetTier} · best ${d.bestSeasons.join(", ")}</p>
            <p class="weather-line">🌤️ ${d.typicalWeather}</p>
            <div>${d.vibeTags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
            <p>${d.whyProfile}</p>
            <div class="dest-actions">
              <a class="btn-link" href="${d.links.flights.googleFlights}" target="_blank" rel="noopener">Check flights ↗</a>
              <button class="btn-link" data-find-stays="${d.id}">Find real stays</button>
              <button class="btn-link" data-view-detail="${d.id}">View details →</button>
            </div>
            <div class="stay-results" id="stays-${d.id}" hidden></div>
          </div>
          ${d.image ? `<div class="photo-credit">📷 ${d.landmarkQuery}, via Wikipedia</div>` : ""}
        </div>`;
      })
      .join("");
    populatePlanDestinationSelect(suggestions);
    $$("#suggestions-list [data-find-stays]").forEach((btn) => {
      btn.addEventListener("click", () => loadStaysInto(btn.dataset.findStays, btn));
    });
    $$("#suggestions-list [data-view-detail]").forEach((btn) => {
      btn.addEventListener("click", () => showDestinationDetail(btn.dataset.viewDetail));
    });
    verifyCardPhotosLoaded(suggestions);
    renderMapMarkers(suggestions);
  } catch (err) {
    el.innerHTML = `<div class="error-banner">Couldn't load suggestions: ${err.message}</div>`;
  }
}

/**
 * The background-image is already set inline, but CSS background-image
 * failures are silent (no error event to hook). This preloads each photo
 * via a real <img> so a broken/blocked URL logs clearly in the console
 * instead of just quietly showing an empty dark card.
 */
function verifyCardPhotosLoaded(suggestions) {
  suggestions.forEach((d) => {
    if (!d.image) return;
    const probe = new Image();
    probe.onerror = () => {
      console.warn(`[trip-planner] landmark photo failed to load for "${d.name}" (${d.landmarkQuery}): ${d.image.imageUrl}`);
      const card = $(`.dest-card[data-id="${d.id}"]`);
      if (card) card.style.backgroundImage = "linear-gradient(160deg, var(--airmail-blue), var(--ink))";
    };
    probe.src = d.image.imageUrl;
  });
}

function showDestinationDetail(destinationId) {
  const d = lastSuggestions.find((s) => s.id === destinationId);
  if (!d) return;
  $("#suggestions-list").hidden = true;
  $("#suggestions-meta").hidden = true;
  const detail = $("#suggestions-detail");
  detail.hidden = false;
  const criteriaHtml = [
    ...d.match.matched.map((label) => `<span class="criterion-pill yes">✓ ${label}</span>`),
    ...d.match.unmatched.map((label) => `<span class="criterion-pill no">${label}</span>`),
  ].join("");
  const heroStyle = d.image
    ? `style="background-image: linear-gradient(180deg, rgba(15,23,32,0.25) 0%, rgba(15,23,32,0.85) 100%), url('${d.image.imageUrl}')"`
    : "";
  detail.innerHTML = `
    <div class="detail-hero ${d.image ? "" : "no-photo"}" ${heroStyle}>
      <button class="btn-link back-btn" id="detail-back">← Back to all suggestions</button>
      <h2>${d.name}, ${d.country}</h2>
      <span class="match-badge ${matchBadgeClass(d.match)}">${d.match.score}/${d.match.total} profile fit</span>
    </div>
    <div class="detail-body">
      <div class="detail-stats">
        <div class="stat"><div class="stat-label">Flight</div><div class="stat-value">${d.flightTimeFromHome} from home (${d.airportCode})</div></div>
        <div class="stat"><div class="stat-label">Budget</div><div class="stat-value">${d.budgetTier}</div></div>
        <div class="stat"><div class="stat-label">Weather</div><div class="stat-value">${d.typicalWeather}</div></div>
        <div class="stat"><div class="stat-label">Best seasons</div><div class="stat-value">${d.bestSeasons.join(", ")}</div></div>
      </div>
      <div class="section-title">Why it fits your profile</div>
      <div class="detail-criteria">${criteriaHtml}</div>
      <p>${d.whyProfile}</p>
      <div class="section-title">Notes</div>
      <p class="muted"><strong>Stay:</strong> ${d.accommodationNotes}</p>
      <p class="muted"><strong>Food &amp; drink:</strong> ${d.foodNotes}</p>
      <p class="muted"><strong>Activities:</strong> ${d.activityNotes}</p>
      <p class="muted"><strong>Logistics:</strong> ${d.logisticsNotes || "—"}</p>
      <div class="dest-actions" style="margin-top:10px;">
        <a class="btn-link" href="${d.links.flights.googleFlights}" target="_blank" rel="noopener">Check flights ↗</a>
        <a class="btn-link" href="${d.links.flights.skyscanner}" target="_blank" rel="noopener">Skyscanner ↗</a>
        <button class="btn-link" data-find-stays="${d.id}">Find real stays</button>
        <button class="btn-link" data-show-photos="${d.id}">📷 Photos</button>
        <button class="btn-link" id="chat-toggle">💬 Customize with AI chat</button>
      </div>
      <div class="stay-results" id="stays-${d.id}" hidden></div>
      <div class="photo-gallery" id="gallery-${d.id}" hidden></div>
      <div id="chat-panel"></div>
    </div>
  `;
  $("#detail-back").addEventListener("click", closeDestinationDetail);
  $(`#suggestions-detail [data-find-stays]`).addEventListener("click", (e) => loadStaysInto(d.id, e.target));
  $(`#suggestions-detail [data-show-photos]`).addEventListener("click", (e) => loadPhotoGallery(d, e.target));
  $("#chat-toggle").addEventListener("click", () => openChatPanel(d));
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Fetched once per open (see loaded flag on the gallery container) since
// the underlying Wikipedia data doesn't change within a session — re-clicking
// just re-toggles visibility instead of re-fetching.
async function loadPhotoGallery(destination, triggerBtn) {
  const out = $(`#gallery-${destination.id}`);
  if (out.dataset.loaded === "true") {
    out.hidden = !out.hidden;
    return;
  }
  out.hidden = false;
  out.innerHTML = `<p class="muted">Looking for more photos…</p>`;
  triggerBtn.disabled = true;
  try {
    const { photos } = await api(`landmark-photos?landmarkQuery=${encodeURIComponent(destination.landmarkQuery)}`);
    if (photos.length === 0) {
      out.innerHTML = `<p class="muted">No extra photos found for ${destination.landmarkQuery} beyond the one above.</p>`;
    } else {
      out.innerHTML = photos
        .map(
          (p) => `
        <a href="${p.url}" target="_blank" rel="noopener" class="gallery-thumb" title="${p.caption}">
          <img src="${p.url}" alt="${p.caption}" loading="lazy" />
        </a>`
        )
        .join("");
    }
    out.dataset.loaded = "true";
  } catch (err) {
    out.innerHTML = `<div class="error-banner">Couldn't load photos: ${err.message}</div>`;
  } finally {
    triggerBtn.disabled = false;
  }
}

function closeDestinationDetail() {
  $("#suggestions-detail").hidden = true;
  $("#suggestions-list").hidden = false;
  $("#suggestions-meta").hidden = false;
  $("#suggestions-list").scrollIntoView({ behavior: "smooth", block: "start" });
  chatMessages = [];
  chatDestination = null;
}

// ---------- AI chat customization ----------
let chatMessages = [];
let chatDestination = null;

function renderChatBubbles() {
  const container = $("#chat-messages");
  if (!container) return;
  container.innerHTML = chatMessages
    .map((m) => `<div class="chat-bubble ${m.role}">${m.content.replace(/</g, "&lt;")}</div>`)
    .join("");
  container.scrollTop = container.scrollHeight;
}

function openChatPanel(destination) {
  chatDestination = destination;
  if (chatMessages.length === 0) {
    chatMessages = [
      { role: "assistant", content: `Ask me anything about tailoring a trip to ${destination.name} — swap a day, ask about a specific park, adjust the pace, whatever's on your mind.` },
    ];
  }
  const panel = $("#chat-panel");
  panel.innerHTML = `
    <div class="chat-panel">
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-row">
        <input type="text" id="chat-input" placeholder="Ask about ${destination.name}…" />
        <button class="primary" id="chat-send">Send</button>
      </div>
    </div>`;
  renderChatBubbles();
  $("#chat-send").addEventListener("click", sendChatMessage);
  $("#chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChatMessage();
  });
  $("#chat-toggle").hidden = true;
}

async function sendChatMessage() {
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text || !chatDestination) return;
  input.value = "";
  chatMessages.push({ role: "user", content: text });
  renderChatBubbles();
  const sendBtn = $("#chat-send");
  sendBtn.disabled = true;
  try {
    const { reply } = await api("chat", {
      method: "POST",
      body: JSON.stringify({ destinationId: chatDestination.id, messages: chatMessages }),
    });
    chatMessages.push({ role: "assistant", content: reply });
    renderChatBubbles();
  } catch (err) {
    chatMessages.push({ role: "assistant", content: `(couldn't reply: ${err.message})` });
    renderChatBubbles();
  } finally {
    sendBtn.disabled = false;
  }
}

async function loadStaysInto(destinationId, triggerBtn) {
  const out = $(`#stays-${destinationId}`);
  out.hidden = false;
  out.innerHTML = `<p class="muted">Searching for real places to stay…</p>`;
  if (triggerBtn) triggerBtn.disabled = true;
  try {
    const { listings, curatedNotes, links, source } = await api(`accommodations?destinationId=${encodeURIComponent(destinationId)}`);
    let html = "";
    if (listings.length > 0) {
      html += listings
        .map(
          (l) => `
        <div class="stay-listing">
          ${l.photoUrl ? `<img src="${l.photoUrl}" alt="" loading="lazy" />` : `<div style="width:64px;height:64px;border-radius:8px;background:var(--chart);flex-shrink:0;"></div>`}
          <div class="stay-meta">
            <div class="name">${l.name}${l.rating ? ` · ★ ${l.rating} (${l.ratingCount})` : ""}</div>
            <div class="muted">${l.address}</div>
            ${l.mapsUrl ? `<a class="btn-link" style="margin-top:4px;" href="${l.mapsUrl}" target="_blank" rel="noopener">View on Maps ↗</a>` : ""}
          </div>
        </div>`
        )
        .join("");
    } else {
      html += `<p class="muted">${source === "curated-notes-only" ? "Live search isn't configured (no GOOGLE_MAPS_API_KEY) — here's what's already known:" : "No live results — here's what's already known:"} ${curatedNotes}</p>`;
    }
    html += `<div class="dest-actions" style="margin-top:8px;">
      <a class="btn-link" href="${links.accommodation.booking}" target="_blank" rel="noopener">Search Booking.com ↗</a>
      <a class="btn-link" href="${links.accommodation.airbnb}" target="_blank" rel="noopener">Search Airbnb ↗</a>
    </div>`;
    out.innerHTML = html;
  } catch (err) {
    out.innerHTML = `<div class="error-banner">Couldn't load stays: ${err.message}</div>`;
  } finally {
    if (triggerBtn) triggerBtn.disabled = false;
  }
}

function populatePlanDestinationSelect(suggestions) {
  const sel = $("#plan-destination");
  sel.innerHTML = suggestions.map((d) => `<option value="${d.id}">${d.name}, ${d.country}</option>`).join("");
}

// ---------- Map ----------
// Creates the Leaflet instance once. Destination markers are handled
// separately by renderMapMarkers() so the map can be refreshed every time
// suggestions change (e.g. a personalized list regenerating after a
// profile edit) without recreating the whole map — re-calling this a
// second time used to be a silent no-op (`if (canvas || mapInstance) return`),
// which is why the map never updated after the first load.
let markerLayer = null;

function initMap() {
  if (!window.L) return;
  const canvas = $("#map-canvas");
  if (!canvas || mapInstance) return;

  mapInstance = L.map(canvas).setView([48, 10], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 18,
  }).addTo(mapInstance);

  // Home marker as the fixed origin point.
  L.circleMarker([51.5074, -0.1278], { radius: 6, color: "#2b5c7a", fillOpacity: 1 })
    .addTo(mapInstance)
    .bindPopup("<h4>Home base</h4>");

  markerLayer = L.layerGroup().addTo(mapInstance);
}

/** Clears and re-adds destination markers. Called every time suggestions load, not just once. */
function renderMapMarkers(suggestions) {
  if (!mapInstance || !markerLayer) return;
  markerLayer.clearLayers();
  const bounds = [[51.5074, -0.1278]];
  suggestions.forEach((d) => {
    if (!d.coordinates) return;
    const marker = L.circleMarker([d.coordinates.lat, d.coordinates.lng], {
      radius: 7,
      color: "#c2452f",
      fillColor: "#c2452f",
      fillOpacity: 0.85,
    }).addTo(markerLayer);
    marker.bindPopup(
      `${d.image ? `<img class="popup-thumb" src="${d.image.imageUrl}" alt="" />` : ""}<h4>${d.name}, ${d.country}</h4>${d.flightTimeFromHome} flight · ${d.budgetTier}<br/><a href="${d.links.flights.googleFlights}" target="_blank" rel="noopener">Check flights ↗</a>`
    );
    bounds.push([d.coordinates.lat, d.coordinates.lng]);
  });
  if (bounds.length > 1) mapInstance.fitBounds(bounds, { padding: [30, 30] });
}

// ---------- Visited Places ----------
const RATING_ICON = { great: "🟢", okay: "🟡", poor: "🔴" };

async function loadVisited() {
  const el = $("#visited-list");
  try {
    const { visitedPlaces } = await api("visited-places");
    if (visitedPlaces.length === 0) {
      el.innerHTML = `<p class="muted">Nothing logged yet — add a place above once you've been.</p>`;
      return;
    }
    el.innerHTML = visitedPlaces
      .map(
        (p) => `
        <div class="stamp-card">
          <div class="stamp-meta">${p.year || "visited"}${p.rating ? ` · <span class="rating-badge">${RATING_ICON[p.rating]}</span>` : ""}</div>
          <div class="stamp-name">${p.name}${p.country ? `, ${p.country}` : ""}</div>
          ${p.notes ? `<div class="stamp-notes">${p.notes}</div>` : ""}
          <button class="link" data-remove="${p.id}">remove</button>
        </div>`
      )
      .join("");
    $$("#visited-list [data-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api(`visited-places?id=${encodeURIComponent(btn.dataset.remove)}`, { method: "DELETE" });
        await Promise.all([loadVisited(), loadSuggestions()]);
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="error-banner">Couldn't load visited places: ${err.message}</div>`;
  }
}

let selectedRating = null;
$$("#rating-chips .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const already = chip.classList.contains("selected");
    $$("#rating-chips .chip").forEach((c) => c.classList.remove("selected"));
    if (!already) {
      chip.classList.add("selected");
      selectedRating = chip.dataset.rating;
    } else {
      selectedRating = null;
    }
  });
});

$("#visited-add-btn").addEventListener("click", async () => {
  const name = $("#visited-name").value.trim();
  if (!name) return;
  const body = {
    name,
    country: $("#visited-country").value.trim(),
    year: $("#visited-year").value.trim(),
    notes: $("#visited-notes").value.trim(),
    rating: selectedRating,
  };
  await api("visited-places", { method: "POST", body: JSON.stringify(body) });
  $("#visited-name").value = "";
  $("#visited-country").value = "";
  $("#visited-year").value = "";
  $("#visited-notes").value = "";
  $$("#rating-chips .chip").forEach((c) => c.classList.remove("selected"));
  selectedRating = null;
  $("#extract-results").innerHTML = "";
  await Promise.all([loadVisited(), loadSuggestions()]);
});

$("#extract-btn").addEventListener("click", async () => {
  const btn = $("#extract-btn");
  const name = $("#visited-name").value.trim();
  const notes = $("#visited-notes").value.trim();
  const out = $("#extract-results");
  if (!name || !notes) {
    out.innerHTML = `<p class="muted">Fill in a place name and some notes first, then extract.</p>`;
    return;
  }
  btn.disabled = true;
  out.innerHTML = `<p class="muted">Reading your notes…</p>`;
  try {
    const { suggestions } = await api("extract-preferences", {
      method: "POST",
      body: JSON.stringify({ placeName: name, notes }),
    });
    if (suggestions.length === 0) {
      out.innerHTML = `<p class="muted">Nothing new to add — either nothing durable stood out, or it's already in your profile.</p>`;
      return;
    }
    out.innerHTML = suggestions
      .map(
        (s, i) => `
      <div class="suggestion-chip-row" id="sug-${i}">
        <div>
          <span class="sug-section">${s.sectionTitle}</span>
          ${s.text}
        </div>
        <div class="sug-actions">
          <button class="accept" data-accept="${i}">Add</button>
          <button class="reject" data-reject="${i}">Skip</button>
        </div>
      </div>`
      )
      .join("");
    $$("#extract-results [data-accept]").forEach((b) => {
      b.addEventListener("click", async () => {
        const s = suggestions[Number(b.dataset.accept)];
        await api("profile", { method: "POST", body: JSON.stringify({ action: "addPoint", sectionId: s.sectionId, text: s.text }) });
        $(`#sug-${b.dataset.accept}`).classList.add("resolved");
        $(`#sug-${b.dataset.accept}`).querySelector(".sug-actions").innerHTML = "Added ✓";
        await loadProfile();
      });
    });
    $$("#extract-results [data-reject]").forEach((b) => {
      b.addEventListener("click", () => {
        $(`#sug-${b.dataset.reject}`).classList.add("resolved");
        $(`#sug-${b.dataset.reject}`).querySelector(".sug-actions").innerHTML = "Skipped";
      });
    });
  } catch (err) {
    out.innerHTML = `<div class="error-banner">${err.message}</div>`;
  } finally {
    btn.disabled = false;
  }
});

// ---------- Plan with AI ----------
// Start date must be before the return date. The date input's own `min`
// (kept in sync below) blocks most of this in the picker UI, but a typed
// or pasted value can still violate it, so re-check on submit too.
function planDatesValid() {
  const checkin = $("#plan-checkin").value;
  const checkout = $("#plan-checkout").value;
  const errorEl = $("#plan-date-error");
  if (checkin && checkout && checkin >= checkout) {
    errorEl.textContent = "Return date must be after the depart date.";
    errorEl.style.display = "";
    return false;
  }
  errorEl.style.display = "none";
  return true;
}

$("#plan-checkin").addEventListener("change", () => {
  const checkin = $("#plan-checkin").value;
  $("#plan-checkout").min = checkin || "";
  planDatesValid();
});
$("#plan-checkout").addEventListener("change", planDatesValid);

$("#plan-btn").addEventListener("click", async () => {
  const btn = $("#plan-btn");
  const out = $("#plan-output");
  const linksOut = $("#plan-links");
  const destinationId = $("#plan-destination").value;
  const checkin = $("#plan-checkin").value;
  const checkout = $("#plan-checkout").value;
  const extra = $("#plan-extra").value.trim();
  if (!destinationId) return;
  if (!planDatesValid()) return;

  const dates = checkin && checkout ? `${checkin} to ${checkout}` : "your chosen dates";

  btn.disabled = true;
  btn.textContent = "Thinking…";
  out.innerHTML = "";
  linksOut.innerHTML = "";
  try {
    const [{ itinerary }, staysRes] = await Promise.all([
      api("plan-trip", { method: "POST", body: JSON.stringify({ destinationId, dates, extra }) }),
      api(`accommodations?destinationId=${encodeURIComponent(destinationId)}${checkin ? `&checkin=${checkin}` : ""}${checkout ? `&checkout=${checkout}` : ""}`).catch(() => null),
    ]);
    out.innerHTML = `<div class="itinerary-output">${itinerary.replace(/</g, "&lt;")}</div>`;
    if (staysRes) {
      linksOut.innerHTML = `<div class="card">
        <h3>Live search, same dates</h3>
        <div class="dest-actions">
          <a class="btn-link" href="${staysRes.links.flights.googleFlights}" target="_blank" rel="noopener">Google Flights ↗</a>
          <a class="btn-link" href="${staysRes.links.flights.skyscanner}" target="_blank" rel="noopener">Skyscanner ↗</a>
          <a class="btn-link" href="${staysRes.links.accommodation.booking}" target="_blank" rel="noopener">Booking.com ↗</a>
          <a class="btn-link" href="${staysRes.links.accommodation.airbnb}" target="_blank" rel="noopener">Airbnb ↗</a>
        </div>
      </div>`;
    }
  } catch (err) {
    out.innerHTML = `<div class="error-banner">${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate itinerary";
  }
});

// ---------- Profile ----------
async function loadProfile() {
  const el = $("#profile-content");
  try {
    const { profile } = await api("profile");
    el.innerHTML =
      `<p class="muted">${profile.travelers} · based in ${profile.home}</p>` +
      profile.sections
        .map(
          (s) => `
        <div class="card">
          <h3>${s.title}</h3>
          <ul class="profile-points">
            ${s.points
              .map(
                (p, i) => `
              <li>
                <span>${p}</span>
                <button class="remove-point" data-remove-point data-section="${s.id}" data-index="${i}">remove</button>
              </li>`
              )
              .join("")}
          </ul>
          <div class="add-point-row">
            <input type="text" placeholder="Add a preference…" data-add-point-input="${s.id}" />
            <button class="btn-link" data-add-point="${s.id}">Add</button>
          </div>
        </div>`
        )
        .join("");

    $$("#profile-content [data-remove-point]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api("profile", {
          method: "POST",
          body: JSON.stringify({ action: "removePoint", sectionId: btn.dataset.section, index: Number(btn.dataset.index) }),
        });
        await loadProfile();
      });
    });
    $$("#profile-content [data-add-point]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const input = $(`[data-add-point-input="${btn.dataset.addPoint}"]`);
        const text = input.value.trim();
        if (!text) return;
        await api("profile", {
          method: "POST",
          body: JSON.stringify({ action: "addPoint", sectionId: btn.dataset.addPoint, text }),
        });
        await loadProfile();
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="error-banner">Couldn't load profile: ${err.message}</div>`;
  }
}

// ---------- Onboarding (first-visit swipe-card flow) ----------
// Shown once per session (gated on profile.onboarded, set server-side —
// see lib/store.js / data/emptyProfile.js) since a brand-new anonymous
// session has no existing profile to fall back on. Answers are written
// into the same profile every other feature reads, via the ordinary
// POST /api/profile endpoint — no separate onboarding storage.

const SWIPE_CARDS = [
  { id: "aparthotel", sectionId: "accommodation", icon: "🏠", text: "Prefer aparthotels or serviced apartments with a kitchen over standard hotel rooms." },
  { id: "lift-access", sectionId: "accommodation", icon: "🛗", text: "Ground-floor or lift access matters (stroller / luggage friendly)." },
  { id: "veg-food", sectionId: "food", icon: "🥗", text: "Genuinely varied vegetarian food options are a priority when picking places to eat." },
  { id: "casual-food", sectionId: "food", icon: "🌮", text: "Casual, kid-friendly local spots over formal sit-down restaurants." },
  { id: "ferry", sectionId: "logistics", icon: "⛴️", text: "For island trips, prefer large conventional ferries over small high-speed speedboats/catamarans." },
  { id: "airport-driving", sectionId: "logistics", icon: "🚗", text: "Prefer driving to the airport with long-stay parking over public transport." },
  { id: "pair-sight-downtime", sectionId: "pace", icon: "🎡", text: "Pair one big sight with kid-friendly downtime nearby (playground, park, treat) rather than back-to-back sightseeing." },
];

const SECTION_TITLES = { pace: "Pace & style", accommodation: "Accommodation", food: "Food & dietary", logistics: "Logistics" };

const onboardingState = { step: 0, travelersRaw: "", kidsAges: "", home: "", acceptedCards: [], paceValue: 50 };
let resolveOnboarding = null;

function onboardingTotalSteps() {
  return 2 + SWIPE_CARDS.length; // basics step + one per swipe card + pace step
}

function updateOnboardingProgress() {
  const bar = $("#onboarding-progress-bar");
  const pct = Math.min(100, Math.round((onboardingState.step / onboardingTotalSteps()) * 100));
  bar.style.width = `${pct}%`;
}

function renderOnboardingStep() {
  const body = $("#onboarding-body");
  updateOnboardingProgress();
  if (onboardingState.step === 0) {
    renderOnboardingBasics(body);
  } else if (onboardingState.step <= SWIPE_CARDS.length) {
    renderOnboardingSwipe(body);
  } else {
    renderOnboardingPace(body);
  }
}

function renderOnboardingBasics(body) {
  body.innerHTML = `
    <div class="onboarding-step">
      <h2>Quick basics</h2>
      <p class="muted">A couple of taps, then the fun part.</p>
      <div class="onboarding-field">
        <label>Who's traveling?</label>
        <div class="chip-group" id="ob-travelers-chips">
          <button type="button" class="chip" data-travelers="Solo traveler">Solo</button>
          <button type="button" class="chip" data-travelers="2 adults">Couple</button>
          <button type="button" class="chip" data-travelers="2 adults + kids">Family with kids</button>
        </div>
      </div>
      <div class="onboarding-field" id="ob-kids-field" hidden>
        <label>Kids' ages?</label>
        <div class="chip-group" id="ob-kids-chips">
          <button type="button" class="chip" data-kids="toddlers">Toddlers</button>
          <button type="button" class="chip" data-kids="young kids">Young kids</button>
          <button type="button" class="chip" data-kids="older kids/teens">Older kids/teens</button>
        </div>
      </div>
      <div class="onboarding-field">
        <label>Home airport / city</label>
        <input type="text" id="ob-home-input" placeholder="e.g. London (LON)" value="${onboardingState.home}" />
      </div>
      <div class="onboarding-actions">
        <button type="button" class="primary" id="ob-basics-continue">Continue</button>
      </div>
    </div>`;

  const kidsField = $("#ob-kids-field");
  $$("#ob-travelers-chips .chip").forEach((chip) => {
    if (chip.dataset.travelers === onboardingState.travelersRaw) chip.classList.add("selected");
    chip.addEventListener("click", () => {
      $$("#ob-travelers-chips .chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      onboardingState.travelersRaw = chip.dataset.travelers;
      if (chip.dataset.travelers === "2 adults + kids") {
        kidsField.hidden = false;
      } else {
        kidsField.hidden = true;
        onboardingState.kidsAges = "";
        $$("#ob-kids-chips .chip").forEach((c) => c.classList.remove("selected"));
      }
    });
  });
  if (onboardingState.travelersRaw === "2 adults + kids") kidsField.hidden = false;

  $$("#ob-kids-chips .chip").forEach((chip) => {
    if (chip.dataset.kids === onboardingState.kidsAges) chip.classList.add("selected");
    chip.addEventListener("click", () => {
      $$("#ob-kids-chips .chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      onboardingState.kidsAges = chip.dataset.kids;
    });
  });

  $("#ob-basics-continue").addEventListener("click", () => {
    onboardingState.home = $("#ob-home-input").value.trim();
    onboardingState.step = 1;
    renderOnboardingStep();
  });
}

function renderOnboardingSwipe(body) {
  const idx = onboardingState.step - 1;
  const card = SWIPE_CARDS[idx];
  const stack = SWIPE_CARDS.slice(idx, idx + 3);

  body.innerHTML = `
    <div class="onboarding-step">
      <h2>What matters to you?</h2>
      <p class="muted">Swipe right (or tap ✓) to add it to your profile, left (or ✕) to skip.</p>
      <div class="swipe-deck" id="swipe-deck">
        ${stack
          .map((c, i) =>
            i === 0
              ? `
          <div class="swipe-card" data-depth="0">
            <div class="swipe-stamp stamp-keep" id="stamp-keep">KEEP</div><div class="swipe-stamp stamp-skip" id="stamp-skip">SKIP</div>
            <div class="swipe-section">${SECTION_TITLES[c.sectionId] || c.sectionId}</div>
            <div class="swipe-icon">${c.icon}</div>
            <div class="swipe-text">${c.text}</div>
          </div>`
              : `<div class="swipe-card" data-depth="${i}"></div>`
          )
          .join("")}
      </div>
      <div class="swipe-buttons">
        <button type="button" class="swipe-btn skip" id="swipe-skip-btn" aria-label="Skip">✕</button>
        <button type="button" class="swipe-btn keep" id="swipe-keep-btn" aria-label="Keep">✓</button>
      </div>
    </div>`;

  const topCard = body.querySelector('.swipe-card[data-depth="0"]');
  wireSwipeGestures(topCard, card);
  $("#swipe-skip-btn").addEventListener("click", () => {
    if (topCard) flingCard(topCard, -1, () => resolveSwipe(card, false));
    else resolveSwipe(card, false);
  });
  $("#swipe-keep-btn").addEventListener("click", () => {
    if (topCard) flingCard(topCard, 1, () => resolveSwipe(card, true));
    else resolveSwipe(card, true);
  });
}

function resolveSwipe(card, keep) {
  if (keep) onboardingState.acceptedCards.push({ sectionId: card.sectionId, text: card.text });
  onboardingState.step += 1;
  renderOnboardingStep();
}

function flingCard(cardEl, direction, done) {
  cardEl.style.transition = "transform 0.3s ease, opacity 0.3s ease";
  cardEl.style.transform = `translate(${direction * 480}px, -30px) rotate(${direction * 28}deg)`;
  cardEl.style.opacity = "0";
  setTimeout(done, 200);
}

function wireSwipeGestures(cardEl) {
  if (!cardEl) return;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  const stampKeep = $("#stamp-keep");
  const stampSkip = $("#stamp-skip");

  cardEl.addEventListener("pointerdown", (e) => {
    dragging = true;
    cardEl.setPointerCapture(e.pointerId);
    cardEl.classList.add("dragging");
    startX = e.clientX;
    startY = e.clientY;
  });

  cardEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
    const dy = e.clientY - startY;
    cardEl.style.transform = `translate(${dx}px, ${dy * 0.15}px) rotate(${dx / 18}deg)`;
    const progress = Math.min(Math.abs(dx) / 120, 1);
    if (stampKeep) stampKeep.style.opacity = dx > 0 ? progress : 0;
    if (stampSkip) stampSkip.style.opacity = dx < 0 ? progress : 0;
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    cardEl.classList.remove("dragging");
    const threshold = 90;
    const cardId = SWIPE_CARDS[onboardingState.step - 1];
    if (dx > threshold) {
      flingCard(cardEl, 1, () => resolveSwipe(cardId, true));
    } else if (dx < -threshold) {
      flingCard(cardEl, -1, () => resolveSwipe(cardId, false));
    } else {
      cardEl.style.transform = "";
      if (stampKeep) stampKeep.style.opacity = 0;
      if (stampSkip) stampSkip.style.opacity = 0;
    }
    dx = 0;
  }

  cardEl.addEventListener("pointerup", endDrag);
  cardEl.addEventListener("pointercancel", endDrag);
}

function paceValueToText(v) {
  if (v <= 33) return "Low-stress pace: a full day at the beach, a park, or a playground beats a packed sightseeing day — max 1-2 planned sights per day, with buffers for pacing and rest stops.";
  if (v <= 66) return "Balanced pace: happy to mix a couple of sights with relaxed downtime each day.";
  return "Fast pace: enjoy packing in multiple sights and activities per day.";
}

function renderOnboardingPace(body) {
  body.innerHTML = `
    <div class="onboarding-step">
      <h2>How do you like to pace a trip?</h2>
      <p class="muted">Drag the slider — this shapes how packed your itineraries feel.</p>
      <div class="pace-slider-row">
        <input type="range" id="ob-pace-slider" min="0" max="100" step="1" value="${onboardingState.paceValue}" />
        <div class="pace-slider-labels"><span>Relaxed</span><span>Packed</span></div>
      </div>
      <div class="pace-slider-value" id="ob-pace-value"></div>
      <div class="onboarding-actions">
        <button type="button" class="primary" id="ob-pace-finish">Finish</button>
      </div>
    </div>`;

  const slider = $("#ob-pace-slider");
  const valueEl = $("#ob-pace-value");
  valueEl.textContent = paceValueToText(Number(slider.value));
  slider.addEventListener("input", () => {
    onboardingState.paceValue = Number(slider.value);
    valueEl.textContent = paceValueToText(onboardingState.paceValue);
  });
  $("#ob-pace-finish").addEventListener("click", finishOnboarding);
}

async function finishOnboarding() {
  const btn = $("#ob-pace-finish");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving…";
  }
  try {
    const pointsBySection = {};
    for (const c of onboardingState.acceptedCards) {
      (pointsBySection[c.sectionId] ||= []).push(c.text);
    }
    (pointsBySection.pace ||= []).push(paceValueToText(onboardingState.paceValue));

    for (const [sectionId, texts] of Object.entries(pointsBySection)) {
      for (const text of texts) {
        await api("profile", { method: "POST", body: JSON.stringify({ action: "addPoint", sectionId, text }) });
      }
    }

    const travelers = onboardingState.kidsAges
      ? `${onboardingState.travelersRaw} (${onboardingState.kidsAges})`
      : onboardingState.travelersRaw;
    const fields = { onboarded: true };
    if (travelers) fields.travelers = travelers;
    if (onboardingState.home) fields.home = onboardingState.home;
    await api("profile", { method: "POST", body: JSON.stringify({ action: "updateFields", fields }) });
  } catch (err) {
    console.warn("[tripsy] onboarding save failed, continuing anyway:", err.message);
  }
  closeOnboarding();
}

function skipOnboarding() {
  api("profile", { method: "POST", body: JSON.stringify({ action: "updateFields", fields: { onboarded: true } }) })
    .catch((err) => console.warn("[tripsy] failed to mark onboarding skipped:", err.message))
    .finally(closeOnboarding);
}

function closeOnboarding() {
  $("#onboarding").hidden = true;
  $("#app").style.display = "";
  if (resolveOnboarding) {
    resolveOnboarding();
    resolveOnboarding = null;
  }
}

function runOnboarding() {
  return new Promise((resolve) => {
    resolveOnboarding = resolve;
    onboardingState.step = 0;
    $("#app").style.display = "none";
    $("#onboarding").hidden = false;
    renderOnboardingStep();
  });
}

$("#onboarding-skip").addEventListener("click", skipOnboarding);

// ---------- Feedback ----------
function openFeedback() {
  $("#feedback-status").textContent = "";
  $("#feedback-text").value = "";
  $("#feedback-modal").hidden = false;
  $("#feedback-text").focus();
}

function closeFeedback() {
  $("#feedback-modal").hidden = true;
}

$("#feedback-fab").addEventListener("click", openFeedback);
$("#feedback-close").addEventListener("click", closeFeedback);
$("#feedback-modal").addEventListener("click", (e) => {
  if (e.target.id === "feedback-modal") closeFeedback(); // click on the dimmed backdrop, not the card
});

$("#feedback-submit").addEventListener("click", async () => {
  const btn = $("#feedback-submit");
  const status = $("#feedback-status");
  const message = $("#feedback-text").value.trim();
  if (!message) {
    status.textContent = "Write something first.";
    return;
  }
  btn.disabled = true;
  status.textContent = "Sending…";
  try {
    const activeTab = document.querySelector("nav.tabs button.active");
    const page = activeTab ? activeTab.dataset.tab : "unknown";
    await api("feedback", { method: "POST", body: JSON.stringify({ message, page }) });
    status.textContent = "Thanks — got it!";
    setTimeout(closeFeedback, 1200);
  } catch (err) {
    status.textContent = `Couldn't send: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

// ---------- Boot ----------
async function bootApp() {
  let profile = null;
  try {
    ({ profile } = await api("profile"));
  } catch (err) {
    /* profile load failing shouldn't block the rest of the app from trying */
  }
  if (profile && !profile.onboarded) {
    await runOnboarding();
  }
  await Promise.all([loadRadar(), loadVisited(), loadProfile()]);
  initMap(); // create the map before loadSuggestions() so its renderMapMarkers() call has somewhere to draw
  await loadSuggestions(); // populates lastSuggestions and renders map markers
}

bootApp();
