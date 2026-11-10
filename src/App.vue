<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import Draggable from "vuedraggable";
import {
  loadGuitars,
  saveGuitar,
  deleteGuitar,
  loadGuitarOrder,
  saveGuitarOrder,
} from "./storage";

const guitars = ref([]);
const loading = ref(true);
const loadError = ref("");
const notice = ref("");
const search = ref("");
const journalFilters = ref({
  brand: "",
  gauge: "",
  guitar: "",
  from: "",
  to: "",
});
const journalSort = ref("date-desc");
const view = ref("home");
const selectedId = ref(null);
const modal = ref("");
const dialog = ref(null);
const saving = ref(false);
const formError = ref("");
const installPrompt = ref(null);
const guitarForm = ref({});
const setupForm = ref({});
const stringForm = ref({});
const photoLoading = ref(false);
const ordering = ref(false);
const dragging = ref(false);
let previousOrder = [];
let photoReadVersion = 0;
let returnFocus = null;

const selected = computed(() =>
  guitars.value.find((guitar) => String(guitar.id) === selectedId.value),
);
const filteredGuitars = computed(() => {
  const query = search.value.trim().toLowerCase();
  return query
    ? guitars.value.filter((guitar) =>
        [
          guitar.make,
          guitar.model,
          guitar.serial,
          specsText(guitar.specs),
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(query),
        ),
      )
    : guitars.value;
});
const allChanges = computed(() =>
  guitars.value
    .flatMap((guitar) =>
      (Array.isArray(guitar.stringChanges) ? guitar.stringChanges : []).map(
        (change, index) => ({ guitar, change, index }),
      ),
    )
    .sort((a, b) =>
      String(b.change.date || "").localeCompare(String(a.change.date || "")),
    ),
);
function normalizedJournalValue(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase();
}
function journalOptions(values) {
  const options = new Map();
  for (const value of values) {
    const label = String(value ?? "").trim();
    const key = normalizedJournalValue(label);
    if (key && !options.has(key)) options.set(key, label);
  }
  return [...options]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}
const journalBrands = computed(() =>
  journalOptions(allChanges.value.map(({ change }) => change.brand)),
);
const journalGauges = computed(() =>
  journalOptions(allChanges.value.map(({ change }) => change.gauge)),
);
const journalGuitars = computed(() =>
  journalOptions(allChanges.value.map(({ guitar }) => guitarName(guitar))),
);
watch(
  [journalBrands, journalGauges, journalGuitars],
  ([brands, gauges, guitarOptions]) => {
    for (const [field, options] of [
      ["brand", brands],
      ["gauge", gauges],
      ["guitar", guitarOptions],
    ]) {
      if (
        journalFilters.value[field] &&
        !options.some((option) => option.value === journalFilters.value[field])
      ) {
        journalFilters.value[field] = "";
      }
    }
  },
);
const filteredChanges = computed(() => {
  const filters = journalFilters.value;
  const matches = (value, selected) =>
    !selected || normalizedJournalValue(value) === selected;
  const [field, direction] = journalSort.value.split("-");
  const valueFor = (entry) =>
    field === "guitar"
      ? guitarName(entry.guitar)
      : String(entry.change[field] || "");
  return allChanges.value
    .filter(
      ({ guitar, change }) =>
        matches(change.brand, filters.brand) &&
        matches(change.gauge, filters.gauge) &&
        matches(guitarName(guitar), filters.guitar) &&
        (!filters.from || (change.date && change.date >= filters.from)) &&
        (!filters.to || (change.date && change.date <= filters.to)),
    )
    .sort((a, b) => {
      const first = valueFor(a);
      const second = valueFor(b);
      if (!first || !second) return first ? -1 : second ? 1 : 0;
      return (
        first.localeCompare(second, undefined, {
          numeric: true,
          sensitivity: "base",
        }) * (direction === "desc" ? -1 : 1)
      );
    });
});
function clearJournalFilters() {
  journalFilters.value = { brand: "", gauge: "", guitar: "", from: "", to: "" };
  journalSort.value = "date-desc";
}
const selectedChanges = computed(() =>
  selected.value
    ? (Array.isArray(selected.value.stringChanges)
        ? selected.value.stringChanges
        : []
      )
        .map((change, index) => ({ change, index }))
        .sort((a, b) =>
          String(b.change.date || "").localeCompare(
            String(a.change.date || ""),
          ),
        )
    : [],
);

function specsText(specs) {
  if (!specs) return "";
  return typeof specs === "string"
    ? specs
    : Object.entries(specs)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");
}
function guitarName(guitar) {
  return (
    [guitar?.make, guitar?.model].filter(Boolean).join(" ") || "Untitled guitar"
  );
}
function formatDate(date) {
  if (!date) return "Date not recorded";
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}
function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function errorMessage(error) {
  return error?.message || "Something went wrong. Please try again.";
}
async function refresh() {
  loading.value = true;
  loadError.value = "";
  try {
    const [records, order] = await Promise.all([
      loadGuitars(),
      loadGuitarOrder(),
    ]);
    const positions = new Map(order.map((id, index) => [id, index]));
    guitars.value = records.sort(
      (a, b) =>
        (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity),
    );
  } catch (error) {
    loadError.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}
async function commitOrder(before) {
  ordering.value = true;
  notice.value = "";
  try {
    await saveGuitarOrder(guitars.value.map((guitar) => guitar.id));
    notice.value = "Collection order saved.";
  } catch (error) {
    guitars.value = before;
    notice.value = `Could not save collection order: ${errorMessage(error)}`;
  } finally {
    ordering.value = false;
  }
}
function startDrag() {
  previousOrder = [...guitars.value];
  dragging.value = true;
}
function updateDragOrder(order) {
  if (!search.value.trim() && !ordering.value) guitars.value = order;
}
function endDrag(event) {
  dragging.value = false;
  if (event.oldIndex !== event.newIndex) commitOrder(previousOrder);
}
async function moveGuitar(index, direction) {
  if (ordering.value || dragging.value || search.value.trim()) return;
  const target = index + direction;
  if (target < 0 || target >= guitars.value.length) return;
  const before = [...guitars.value];
  const reordered = [...before];
  const [guitar] = reordered.splice(index, 1);
  reordered.splice(target, 0, guitar);
  guitars.value = reordered;
  await commitOrder(before);
}
function readRoute() {
  const hash = window.location.hash;
  if (!hash || hash === "#/" || hash === "#") return { view: "home", id: null };
  if (hash === "#/collection") return { view: "collection", id: null };
  if (hash === "#/care") return { view: "care", id: null };
  if (hash.startsWith("#/guitar/")) {
    try {
      const id = decodeURIComponent(hash.slice("#/guitar/".length));
      if (id) return { view: "detail", id };
    } catch {
      /* Treat malformed URLs as unknown routes. */
    }
  }
  return { view: "home", id: null };
}
function syncRoute() {
  const route = readRoute();
  if (view.value === route.view && selectedId.value === route.id) return;
  photoReadVersion++;
  photoLoading.value = false;
  modal.value = "";
  view.value = route.view;
  selectedId.value = route.id;
  notice.value = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function navigate(destination, id = null, replace = false) {
  const hash =
    destination === "home"
      ? "#/"
      : destination === "detail"
        ? `#/guitar/${encodeURIComponent(String(id))}`
        : `#/${destination}`;
  if (window.location.hash !== hash) {
    window.history[replace ? "replaceState" : "pushState"](null, "", hash);
  }
  syncRoute();
}
function openGuitar(guitar) {
  navigate("detail", guitar.id);
}
function openModal(name) {
  returnFocus = document.activeElement;
  formError.value = "";
  modal.value = name;
}
function closeModal() {
  if (saving.value) return;
  photoReadVersion++;
  photoLoading.value = false;
  modal.value = "";
}
watch(modal, async (value) => {
  if (value) {
    await nextTick();
    if (dialog.value && !dialog.value.open) dialog.value.showModal();
  } else {
    await nextTick();
    if (returnFocus?.isConnected) returnFocus.focus();
  }
});
function editGuitar(guitar = null) {
  guitarForm.value = guitar
    ? { ...guitar, specs: specsText(guitar.specs), photo: guitar.photo || "" }
    : {
        make: "",
        model: "",
        serial: "",
        specs: "",
        photo: "",
        setup: {},
        stringChanges: [],
      };
  openModal(guitar ? "edit-guitar" : "add-guitar");
}
function editSetup() {
  setupForm.value = {
    action: "",
    relief: "",
    pickupHeights: "",
    mods: "",
    ...(selected.value.setup || {}),
  };
  openModal("setup");
}
function addStringChange() {
  stringForm.value = { date: today(), brand: "", gauge: "" };
  openModal("strings");
}
function readPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const version = ++photoReadVersion;
  formError.value = "";
  if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
    formError.value = !file.type.startsWith("image/")
      ? "Please choose an image file."
      : "Please choose an image smaller than 8 MB.";
    photoLoading.value = false;
    event.target.value = "";
    return;
  }
  photoLoading.value = true;
  const reader = new FileReader();
  reader.onload = () => {
    if (version !== photoReadVersion) return;
    guitarForm.value.photo = reader.result;
    photoLoading.value = false;
  };
  reader.onerror = () => {
    if (version !== photoReadVersion) return;
    formError.value = "Could not read that image. Please try another file.";
    photoLoading.value = false;
  };
  reader.readAsDataURL(file);
  event.target.value = "";
}
async function persist(record, success) {
  saving.value = true;
  formError.value = "";
  notice.value = "";
  try {
    const saved = await saveGuitar(record);
    const index = guitars.value.findIndex((guitar) => guitar.id === saved.id);
    if (index === -1) guitars.value.push(saved);
    else guitars.value.splice(index, 1, saved);
    modal.value = "";
    notice.value = success;
    return saved;
  } catch (error) {
    const message = `Could not save your changes: ${errorMessage(error)}`;
    if (modal.value) formError.value = message;
    else notice.value = message;
    return null;
  } finally {
    saving.value = false;
  }
}
async function submitGuitar() {
  if (photoLoading.value || saving.value) return;
  if (!guitarForm.value.make.trim() || !guitarForm.value.model.trim()) {
    formError.value = "Please enter a make and model.";
    return;
  }
  const isNew = modal.value === "add-guitar";
  const origin = window.location.href;
  const originalSpecs = selected.value?.specs;
  const specs =
    !isNew &&
    typeof originalSpecs === "object" &&
    guitarForm.value.specs === specsText(originalSpecs)
      ? originalSpecs
      : guitarForm.value.specs.trim();
  const saved = await persist(
    {
      ...guitarForm.value,
      make: guitarForm.value.make.trim(),
      model: guitarForm.value.model.trim(),
      serial: guitarForm.value.serial.trim(),
      specs,
    },
    isNew ? "Guitar added to your collection." : "Guitar details saved.",
  );
  if (saved && isNew && window.location.href === origin) {
    openGuitar(saved);
    notice.value = "Guitar added to your collection.";
  }
}
async function submitSetup() {
  if (!selected.value || saving.value) return;
  await persist(
    { ...selected.value, setup: { ...setupForm.value } },
    "Setup details saved.",
  );
}
async function submitStrings() {
  if (!selected.value || saving.value) return;
  if (!stringForm.value.brand.trim() || !stringForm.value.gauge.trim()) {
    formError.value = "Please enter a brand and gauge.";
    return;
  }
  await persist(
    {
      ...selected.value,
      stringChanges: [
        ...(selected.value.stringChanges || []),
        {
          ...stringForm.value,
          brand: stringForm.value.brand.trim(),
          gauge: stringForm.value.gauge.trim(),
        },
      ],
    },
    "String change added.",
  );
}
async function removeStringChange(index) {
  if (!selected.value || saving.value) return;
  const changes = [...(selected.value.stringChanges || [])];
  changes.splice(index, 1);
  await persist(
    { ...selected.value, stringChanges: changes },
    "String change removed.",
  );
}
async function removeGuitar() {
  if (!selected.value || saving.value) return;
  const id = selected.value.id;
  saving.value = true;
  formError.value = "";
  try {
    await deleteGuitar(id);
    guitars.value = guitars.value.filter((guitar) => guitar.id !== id);
    modal.value = "";
    if (view.value === "detail" && selectedId.value === String(id))
      navigate("collection", null, true);
    notice.value = "Guitar removed from your collection.";
  } catch (error) {
    formError.value = `Could not delete this guitar: ${errorMessage(error)}`;
  } finally {
    saving.value = false;
  }
}
function handleInstallPrompt(event) {
  event.preventDefault();
  installPrompt.value = event;
}
async function installApp() {
  const prompt = installPrompt.value;
  if (!prompt) return;
  installPrompt.value = null;
  try {
    await prompt.prompt();
    await prompt.userChoice;
  } catch {
    notice.value = "The install prompt could not be opened.";
  }
}
function installed() {
  installPrompt.value = null;
}
onMounted(() => {
  syncRoute();
  window.addEventListener("popstate", syncRoute);
  window.addEventListener("hashchange", syncRoute);
  window.addEventListener("beforeinstallprompt", handleInstallPrompt);
  window.addEventListener("appinstalled", installed);
  refresh();
});
onBeforeUnmount(() => {
  window.removeEventListener("popstate", syncRoute);
  window.removeEventListener("hashchange", syncRoute);
  window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
  window.removeEventListener("appinstalled", installed);
});
</script>

<template>
  <svg class="svg-defs" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <symbol id="i-home" viewBox="0 0 24 24">
      <path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-6h6v6" />
    </symbol>
    <symbol id="i-grid" viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </symbol>
    <symbol id="i-care" viewBox="0 0 24 24">
      <path
        d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3m12 0h3m-4.7-4.3 2.1-2.1M8 16a4 4 0 1 1 8 0c0 1.4-.7 2-1.4 2.7-.4.4-.6.8-.6 1.3h-4c0-.5-.2-.9-.6-1.3C8.7 18 8 17.4 8 16ZM10 22h4"
      />
    </symbol>
    <symbol id="i-plus" viewBox="0 0 24 24">
      <path d="M12 5v14M5 12h14" />
    </symbol>
    <symbol id="i-search" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </symbol>
    <symbol id="i-arrow" viewBox="0 0 24 24">
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </symbol>
    <symbol id="i-back" viewBox="0 0 24 24">
      <path d="M19 12H5m6-6-6 6 6 6" />
    </symbol>
    <symbol id="i-edit" viewBox="0 0 24 24">
      <path d="m4 20 4-.8L19 8.3 15.7 5 4.8 15.9 4 20Zm10-13 3.3 3.3" />
    </symbol>
    <symbol id="i-trash" viewBox="0 0 24 24">
      <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
    </symbol>
    <symbol id="i-close" viewBox="0 0 24 24">
      <path d="m6 6 12 12M18 6 6 18" />
    </symbol>
    <symbol id="i-note" viewBox="0 0 24 24">
      <path d="M9 18V5l10-2v13M9 9l10-2" />
      <ellipse cx="6" cy="18" rx="3" ry="2" />
      <ellipse cx="16" cy="16" rx="3" ry="2" />
    </symbol>
    <symbol id="i-lock" viewBox="0 0 24 24">
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" />
    </symbol>
    <symbol id="i-download" viewBox="0 0 24 24">
      <path d="M12 3v12m-4-4 4 4 4-4M5 17v3h14v-3" />
    </symbol>
  </svg>
  <div class="app-shell">
    <aside class="sidebar">
      <button
        class="brand"
        type="button"
        @click="navigate('home')"
        aria-label="GuitarKeeper home"
      >
        <span class="brand-mark">g<span>k</span><i>.</i></span
        ><span class="brand-name"
          >guitar<span>keeper</span
          ><small>YOUR COLLECTION, CONSIDERED.</small></span
        >
      </button>
      <div class="sidebar-label">YOUR SPACE</div>
      <nav class="side-nav" aria-label="Main navigation">
        <button
          :class="{ active: view === 'home' }"
          :aria-current="view === 'home' ? 'page' : undefined"
          @click="navigate('home')"
        >
          <svg class="icon"><use href="#i-home" /></svg> Home
        </button>
        <button
          :class="{ active: view === 'collection' || view === 'detail' }"
          @click="navigate('collection')"
        >
          <svg class="icon"><use href="#i-grid" /></svg> Collection
          <span v-if="!loading && !loadError" class="nav-count">{{
            guitars.length
          }}</span>
        </button>
        <button :class="{ active: view === 'care' }" @click="navigate('care')">
          <svg class="icon"><use href="#i-care" /></svg> Care journal
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-note">
          <span class="sidebar-note-icon"
            ><svg class="icon"><use href="#i-lock" /></svg></span
          ><strong>Yours to keep.</strong>
          <p>
            Your collection stays on this device. Clearing browser storage can
            delete your data.
          </p>
        </div>
        <button v-if="installPrompt" class="install-link" @click="installApp">
          <svg class="icon"><use href="#i-download" /></svg> Install
          GuitarKeeper
        </button>
        <div class="sidebar-footer">MADE FOR THE MUSIC <span>✳</span></div>
      </div>
    </aside>
    <div class="main-wrap">
      <header class="topbar">
        <div class="mobile-brand">
          <span class="brand-mark">g<span>k</span><i>.</i></span
          ><span>guitar<b>keeper</b></span>
        </div>
        <div class="topbar-title">
          <span class="topbar-dot"></span> A LITTLE SPACE FOR YOUR INSTRUMENTS
        </div>
        <div class="topbar-right">
          <svg class="icon"><use href="#i-lock" /></svg> PRIVATE &amp; LOCAL
        </div>
      </header>
      <nav class="mobile-nav" aria-label="Mobile navigation">
        <button
          :class="{ active: view === 'home' }"
          :aria-current="view === 'home' ? 'page' : undefined"
          @click="navigate('home')"
        >
          <svg class="icon"><use href="#i-home" /></svg> Home</button
        ><button
          :class="{ active: view === 'collection' || view === 'detail' }"
          @click="navigate('collection')"
        >
          <svg class="icon"><use href="#i-grid" /></svg> Collection</button
        ><button :class="{ active: view === 'care' }" @click="navigate('care')">
          <svg class="icon"><use href="#i-care" /></svg> Care journal</button
        ><button v-if="installPrompt" @click="installApp">
          <svg class="icon"><use href="#i-download" /></svg> Install
        </button>
      </nav>
      <main class="content">
        <div v-if="notice" class="notice" role="status">
          {{ notice }}
          <button aria-label="Dismiss message" @click="notice = ''">
            <svg class="icon"><use href="#i-close" /></svg>
          </button>
        </div>
        <div v-if="loading" class="state-panel" role="status">
          <span class="spinner"></span>
          <h2>Getting things ready.</h2>
          <p>Opening your local collection…</p>
        </div>
        <div v-else-if="loadError" class="state-panel error-state" role="alert">
          <span class="state-icon">!</span>
          <h2>We couldn’t open your collection.</h2>
          <p>
            Your browser’s local storage may be unavailable. {{ loadError }}
          </p>
          <button class="button button-primary" @click="refresh">
            Try again <svg class="icon"><use href="#i-arrow" /></svg>
          </button>
        </div>
        <template v-else-if="view === 'home'">
          <div class="page-heading">
            <div>
              <div class="eyebrow"><span></span> WELCOME TO GUITARKEEPER</div>
              <h1>A place for your <em>players.</em></h1>
              <p>Keep the details, the stories, and the setups together.</p>
            </div>
            <button
              class="button button-primary heading-action"
              @click="editGuitar()"
            >
              <svg class="icon"><use href="#i-plus" /></svg> Add a guitar
            </button>
          </div>
          <section class="intro-banner" aria-label="About your collection">
            <div class="banner-copy">
              <span class="banner-kicker">THE COLLECTION</span>
              <h2>Every guitar has<br /><em>a story to tell.</em></h2>
              <p>
                From the first chord to the latest setup, give your instruments
                a home.
              </p>
              <span class="banner-rule"></span
              ><span class="banner-foot"
                >A LITTLE MORE ORGANIZED. A LOT MORE PLAYING.</span
              >
            </div>
          </section>
          <div class="home-section-heading">
            <div class="eyebrow muted">YOUR SPACE</div>
            <h2>Pick up where you left off.</h2>
          </div>
          <div class="home-links">
            <button class="home-link" @click="navigate('collection')">
              <span class="home-link-icon"
                ><svg class="icon"><use href="#i-grid" /></svg></span
              ><span class="home-link-copy"
                ><strong>Your collection</strong
                ><span
                  >{{ guitars.length }}
                  {{ guitars.length === 1 ? "guitar" : "guitars" }} saved on
                  this device</span
                ></span
              ><svg class="icon home-link-arrow"><use href="#i-arrow" /></svg>
            </button>
            <button class="home-link" @click="navigate('care')">
              <span class="home-link-icon"
                ><svg class="icon"><use href="#i-care" /></svg></span
              ><span class="home-link-copy"
                ><strong>Care journal</strong
                ><span
                  >{{ allChanges.length }}
                  {{
                    allChanges.length === 1 ? "string change" : "string changes"
                  }}
                  recorded</span
                ></span
              ><svg class="icon home-link-arrow"><use href="#i-arrow" /></svg>
            </button>
          </div>
        </template>
        <template v-else-if="view === 'collection'">
          <div class="page-heading">
            <div>
              <div class="eyebrow">
                <span></span> YOUR PERSONAL GUITAR ARCHIVE
              </div>
              <h1>Your <em>collection.</em></h1>
              <p>Keep the details, the stories, and the setups together.</p>
            </div>
            <button
              class="button button-primary heading-action"
              @click="editGuitar()"
            >
              <svg class="icon"><use href="#i-plus" /></svg> Add a guitar
            </button>
          </div>
          <div class="section-heading">
            <div>
              <div class="eyebrow muted">THE GOOD STUFF</div>
              <h2>
                Your collection
                <span class="item-count">{{ guitars.length }}</span>
              </h2>
            </div>
            <label class="search"
              ><svg class="icon"><use href="#i-search" /></svg
              ><span class="sr-only">Search your guitars</span
              ><input
                v-model="search"
                type="search"
                placeholder="Search your guitars…"
            /></label>
          </div>
          <div v-if="!guitars.length" class="empty-collection">
            <div class="empty-icon">
              <svg class="icon"><use href="#i-note" /></svg>
            </div>
            <h3>It starts with one guitar.</h3>
            <p>
              Your collection is a blank canvas. Add your first guitar and make
              this space yours.
            </p>
            <button class="button button-outline" @click="editGuitar()">
              <svg class="icon"><use href="#i-plus" /></svg> Add your first
              guitar
            </button>
          </div>
          <div
            v-else-if="!filteredGuitars.length"
            class="empty-collection compact"
          >
            <div class="empty-icon">
              <svg class="icon"><use href="#i-search" /></svg>
            </div>
            <h3>No guitars found.</h3>
            <p>
              Try a different search term, or clear your search to see
              everything.
            </p>
            <button class="text-button" @click="search = ''">
              Clear search <svg class="icon"><use href="#i-arrow" /></svg>
            </button>
          </div>
          <template v-else>
            <p v-if="search.trim()" class="sort-hint">
              Clear your search to reorder the collection.
            </p>
            <p v-else-if="guitars.length > 1" class="sort-hint">
              Drag the handle to reorder, or use the move buttons.
            </p>
            <Draggable
              class="guitar-grid"
              :model-value="filteredGuitars"
              item-key="id"
              handle=".drag-handle"
              :force-fallback="true"
              :disabled="!!search.trim() || ordering || guitars.length < 2"
              :animation="150"
              ghost-class="guitar-ghost"
              @start="startDrag"
              @update:model-value="updateDragOrder"
              @end="endDrag"
            >
              <template #item="{ element: guitar, index }">
                <div class="guitar-card-wrap">
                  <button
                    class="guitar-card"
                    type="button"
                    @click="openGuitar(guitar)"
                  >
                    <div class="card-image">
                      <img
                        v-if="guitar.photo"
                        :src="guitar.photo"
                        :alt="guitarName(guitar)"
                      />
                      <div v-else class="photo-placeholder">
                        <svg class="icon"><use href="#i-note" /></svg
                        ><span>NO PHOTO YET</span>
                      </div>
                      <span class="card-number">{{
                        String(index + 1).padStart(2, "0")
                      }}</span
                      ><span class="card-arrow"
                        ><svg class="icon"><use href="#i-arrow" /></svg
                      ></span>
                    </div>
                    <div class="card-info">
                      <span class="card-kicker">{{
                        guitar.make || "YOUR GUITAR"
                      }}</span>
                      <h3>{{ guitar.model || guitarName(guitar) }}</h3>
                      <p>
                        {{
                          guitar.serial
                            ? `S/N ${guitar.serial}`
                            : "No serial number added"
                        }}
                      </p>
                    </div>
                  </button>
                  <div
                    v-if="guitars.length > 1"
                    class="sort-controls"
                    :aria-label="`Reorder ${guitarName(guitar)}`"
                  >
                    <span
                      class="drag-handle"
                      :class="{ 'drag-disabled': !!search.trim() || ordering }"
                      aria-hidden="true"
                      title="Drag to reorder"
                      >⠿</span
                    >
                    <button
                      type="button"
                      :aria-label="`Move ${guitarName(guitar)} earlier`"
                      title="Move earlier"
                      :disabled="
                        !!search.trim() || ordering || dragging || index === 0
                      "
                      @click="moveGuitar(index, -1)"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      :aria-label="`Move ${guitarName(guitar)} later`"
                      title="Move later"
                      :disabled="
                        !!search.trim() ||
                        ordering ||
                        dragging ||
                        index === guitars.length - 1
                      "
                      @click="moveGuitar(index, 1)"
                    >
                      →
                    </button>
                  </div>
                </div>
              </template>
            </Draggable>
          </template>
        </template>
        <template v-else-if="view === 'detail' && selected">
          <button class="back-link" @click="navigate('collection')">
            <svg class="icon"><use href="#i-back" /></svg> Back to collection
          </button>
          <div class="detail-heading">
            <div>
              <div class="eyebrow"><span></span> IN THE COLLECTION</div>
              <h1>
                {{ selected.make }} <em>{{ selected.model }}</em>
              </h1>
              <p>A little home for all the details that make it yours.</p>
            </div>
            <div class="detail-actions">
              <button
                class="button button-outline"
                @click="editGuitar(selected)"
              >
                <svg class="icon"><use href="#i-edit" /></svg> Edit guitar</button
              ><button
                class="icon-button danger"
                aria-label="Delete guitar"
                title="Delete guitar"
                @click="openModal('delete')"
              >
                <svg class="icon"><use href="#i-trash" /></svg>
              </button>
            </div>
          </div>
          <div class="detail-grid">
            <div class="detail-main">
              <section class="profile-card">
                <div class="profile-photo">
                  <img
                    v-if="selected.photo"
                    :src="selected.photo"
                    :alt="guitarName(selected)"
                  />
                  <div v-else class="photo-placeholder">
                    <svg class="icon"><use href="#i-note" /></svg
                    ><span>NO PHOTO YET</span>
                  </div>
                </div>
                <div class="profile-info">
                  <div class="eyebrow muted">THE PARTICULARS</div>
                  <h2>Meet your guitar.</h2>
                  <dl class="details-list">
                    <div>
                      <dt>Make</dt>
                      <dd>{{ selected.make || "Not added" }}</dd>
                    </div>
                    <div>
                      <dt>Model</dt>
                      <dd>{{ selected.model || "Not added" }}</dd>
                    </div>
                    <div>
                      <dt>Serial number</dt>
                      <dd>{{ selected.serial || "Not added" }}</dd>
                    </div>
                    <div>
                      <dt>Additional specs</dt>
                      <dd class="preserve">
                        {{
                          specsText(selected.specs) || "No details added yet"
                        }}
                      </dd>
                    </div>
                  </dl>
                </div>
              </section>
              <section class="content-card">
                <div class="card-section-header">
                  <div>
                    <div class="eyebrow muted">DIALED IN</div>
                    <h2>Setup notes</h2>
                    <p>The little details that make it feel just right.</p>
                  </div>
                  <button
                    class="button button-small button-outline"
                    @click="editSetup()"
                  >
                    <svg class="icon"><use href="#i-edit" /></svg> Edit setup
                  </button>
                </div>
                <div class="setup-grid">
                  <div>
                    <span>ACTION</span>
                    <p>{{ selected.setup?.action || "Not recorded" }}</p>
                  </div>
                  <div>
                    <span>NECK RELIEF</span>
                    <p>{{ selected.setup?.relief || "Not recorded" }}</p>
                  </div>
                  <div>
                    <span>PICKUP HEIGHTS</span>
                    <p>{{ selected.setup?.pickupHeights || "Not recorded" }}</p>
                  </div>
                  <div>
                    <span>MODS &amp; NOTES</span>
                    <p class="preserve">
                      {{ selected.setup?.mods || "Not recorded" }}
                    </p>
                  </div>
                </div>
              </section>
              <section class="content-card">
                <div class="card-section-header">
                  <div>
                    <div class="eyebrow muted">FRESH STRINGS, GOOD THINGS</div>
                    <h2>String history</h2>
                    <p>A record of the changes along the way.</p>
                  </div>
                  <button
                    class="button button-small button-outline"
                    @click="addStringChange()"
                  >
                    <svg class="icon"><use href="#i-plus" /></svg> Add change
                  </button>
                </div>
                <div v-if="!selectedChanges.length" class="inline-empty">
                  No string changes recorded yet. Add one when it’s time for a
                  fresh set.
                </div>
                <ul v-else class="history-list">
                  <li v-for="{ change, index } in selectedChanges" :key="index">
                    <span class="history-icon"
                      ><svg class="icon"><use href="#i-note" /></svg
                    ></span>
                    <div>
                      <strong>{{ change.brand || "String change" }}</strong>
                      <p>{{ change.gauge || "Gauge not recorded" }}</p>
                    </div>
                    <time>{{ formatDate(change.date) }}</time
                    ><button
                      class="icon-button subtle danger"
                      :disabled="saving"
                      :aria-label="`Remove string change from ${formatDate(change.date)}`"
                      title="Remove string change"
                      @click="removeStringChange(index)"
                    >
                      <svg class="icon"><use href="#i-trash" /></svg>
                    </button>
                  </li>
                </ul>
              </section>
            </div>
            <aside class="detail-aside">
              <div class="aside-card">
                <span class="aside-symbol">✳</span>
                <div class="eyebrow muted">A NOTE FROM US</div>
                <h3>Made to be<br /><em>played.</em></h3>
                <p>
                  Keep track of the details so you can spend more time making
                  music.
                </p>
              </div>
              <div class="privacy-note">
                <svg class="icon"><use href="#i-lock" /></svg>
                <p>
                  <strong>Just between us.</strong><br />Data is stored only on
                  this device. Clearing browser storage can delete it.
                </p>
              </div>
            </aside>
          </div>
        </template>
        <div v-else-if="view === 'detail'" class="state-panel">
          <h2>Guitar not found.</h2>
          <p>
            This guitar may have been removed or may not be stored on this
            device.
          </p>
          <button class="button button-primary" @click="navigate('collection')">
            Go to collection <svg class="icon"><use href="#i-arrow" /></svg>
          </button>
        </div>
        <template v-else-if="view === 'care'">
          <div class="page-heading">
            <div>
              <div class="eyebrow"><span></span> THE CARE JOURNAL</div>
              <h1>Well cared for, <em>well played.</em></h1>
              <p>A little history of the love you put into your instruments.</p>
            </div>
          </div>
          <section class="content-card journal-card">
            <div class="card-section-header">
              <div>
                <div class="eyebrow muted">ACROSS YOUR COLLECTION</div>
                <h2>String changes</h2>
                <p>Your most recent changes, all in one place.</p>
              </div>
            </div>
            <div v-if="!allChanges.length" class="inline-empty journal-empty">
              <span class="empty-icon"
                ><svg class="icon"><use href="#i-note" /></svg
              ></span>
              <h3>Nothing in the journal yet.</h3>
              <p>Open a guitar in your collection to record a string change.</p>
              <button class="text-button" @click="navigate('collection')">
                Go to collection <svg class="icon"><use href="#i-arrow" /></svg>
              </button>
            </div>
            <template v-else>
              <details class="journal-filter-panel">
                <summary>
                  <span
                    >Filters &amp; sorting<span
                      v-if="
                        Object.values(journalFilters).some(Boolean) ||
                        journalSort !== 'date-desc'
                      "
                      class="filter-active"
                      >Active</span
                    ></span
                  ><span class="filter-chevron" aria-hidden="true"></span>
                </summary>
                <div
                  class="journal-filters"
                  aria-label="Filter and sort string changes"
                >
                  <label
                    >String brand<select v-model="journalFilters.brand">
                      <option value="">All brands</option>
                      <option
                        v-for="option in journalBrands"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select></label
                  >
                  <label
                    >Gauge<select v-model="journalFilters.gauge">
                      <option value="">All gauges</option>
                      <option
                        v-for="option in journalGauges"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select></label
                  >
                  <label
                    >Guitar<select v-model="journalFilters.guitar">
                      <option value="">All guitars</option>
                      <option
                        v-for="option in journalGuitars"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select></label
                  >
                  <label
                    >From date<input v-model="journalFilters.from" type="date"
                  /></label>
                  <label
                    >To date<input v-model="journalFilters.to" type="date"
                  /></label>
                  <label
                    >Sort by<select v-model="journalSort">
                      <option value="date-desc">Date: newest first</option>
                      <option value="date-asc">Date: oldest first</option>
                      <option value="brand-asc">Brand: A–Z</option>
                      <option value="brand-desc">Brand: Z–A</option>
                      <option value="gauge-asc">Gauge: ascending</option>
                      <option value="gauge-desc">Gauge: descending</option>
                      <option value="guitar-asc">Guitar: A–Z</option>
                      <option value="guitar-desc">Guitar: Z–A</option>
                    </select></label
                  >
                </div>
              </details>
              <div class="journal-results">
                <span role="status"
                  >{{ filteredChanges.length }} of {{ allChanges.length }}
                  {{ allChanges.length === 1 ? "change" : "changes" }}</span
                ><button
                  type="button"
                  class="text-button"
                  @click="clearJournalFilters"
                >
                  Clear filters
                </button>
              </div>
              <div
                v-if="!filteredChanges.length"
                class="inline-empty journal-empty"
              >
                <h3>No matching changes.</h3>
                <p>Try adjusting your filters or date range.</p>
                <button
                  type="button"
                  class="text-button"
                  @click="clearJournalFilters"
                >
                  Clear filters <svg class="icon"><use href="#i-arrow" /></svg>
                </button>
              </div>
              <ul v-else class="history-list journal-list">
                <li
                  v-for="entry in filteredChanges"
                  :key="`${entry.guitar.id}-${entry.index}`"
                >
                  <button
                    type="button"
                    class="journal-entry"
                    @click="openGuitar(entry.guitar)"
                  >
                    <span class="history-icon" aria-hidden="true"
                      ><svg class="icon"><use href="#i-note" /></svg
                    ></span>
                    <span class="journal-entry-copy"
                      ><strong>{{ guitarName(entry.guitar) }}</strong
                      ><span
                        >Strings:
                        {{ entry.change.brand || "Brand not recorded" }} ·
                        {{ entry.change.gauge || "Gauge not recorded" }}</span
                      ></span
                    >
                    <time>{{ formatDate(entry.change.date) }}</time>
                    <svg class="icon journal-entry-arrow" aria-hidden="true">
                      <use href="#i-arrow" />
                    </svg>
                  </button>
                </li>
              </ul>
            </template>
          </section>
        </template>
        <footer class="page-footer">
          <span>GUITARKEEPER <span>✳</span> A GOOD PLACE FOR GOOD GUITARS.</span
          ><span>YOUR DATA STAYS HERE.</span
          ><span class="mobile-privacy"
            >Stored only on this device. Clearing browser storage can delete
            your data.</span
          >
        </footer>
      </main>
    </div>
  </div>
  <dialog
    v-if="modal"
    ref="dialog"
    class="modal"
    aria-labelledby="modal-title"
    @cancel.prevent="closeModal"
    @close="closeModal"
  >
    <div class="modal-header">
      <div>
        <div class="eyebrow muted">
          {{ modal === "delete" ? "A MOMENT TO BE SURE" : "THE DETAILS" }}
        </div>
        <h2 id="modal-title">
          {{
            {
              "add-guitar": "Add a guitar",
              "edit-guitar": "Edit guitar",
              setup: "Edit setup",
              strings: "Log a string change",
              delete: "Remove this guitar?",
            }[modal]
          }}
        </h2>
      </div>
      <button
        class="icon-button subtle"
        aria-label="Close dialog"
        :disabled="saving"
        @click="closeModal"
      >
        <svg class="icon"><use href="#i-close" /></svg>
      </button>
    </div>
    <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
    <form
      v-if="modal === 'add-guitar' || modal === 'edit-guitar'"
      @submit.prevent="submitGuitar"
    >
      <p class="modal-intro">
        The beginnings of a beautiful record. You can always add more later.
      </p>
      <div class="form-grid">
        <label
          >Make <span class="required">*</span
          ><input
            v-model="guitarForm.make"
            required
            maxlength="120"
            placeholder="e.g. Fender"
            autofocus /></label
        ><label
          >Model <span class="required">*</span
          ><input
            v-model="guitarForm.model"
            required
            maxlength="120"
            placeholder="e.g. Telecaster" /></label
        ><label class="full-width"
          >Serial number <span class="optional">OPTIONAL</span
          ><input
            v-model="guitarForm.serial"
            maxlength="200"
            placeholder="The number on your instrument" /></label
        ><label class="full-width"
          >Additional specs <span class="optional">OPTIONAL</span
          ><textarea
            v-model="guitarForm.specs"
            rows="3"
            placeholder="Year, finish, pickups, or anything worth remembering"
          ></textarea>
        </label>
        <div class="full-width photo-field">
          <span class="field-label"
            >Photo <span class="optional">OPTIONAL · MAX 8 MB</span></span
          >
          <div class="photo-upload">
            <img
              v-if="guitarForm.photo"
              :src="guitarForm.photo"
              alt="Selected guitar photo"
            />
            <div v-else class="upload-placeholder">
              <svg class="icon"><use href="#i-note" /></svg>
            </div>
            <div>
              <label class="upload-button" for="guitar-photo">{{
                guitarForm.photo ? "Change photo" : "Choose a photo"
              }}</label
              ><input
                id="guitar-photo"
                class="sr-only"
                type="file"
                accept="image/*"
                @change="readPhoto"
              /><button
                v-if="guitarForm.photo"
                type="button"
                class="remove-photo"
                @click="
                  photoReadVersion++;
                  photoLoading = false;
                  guitarForm.photo = '';
                "
              >
                Remove
              </button>
              <p>
                {{
                  photoLoading ? "Reading image…" : "An image from your device."
                }}
              </p>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button
          type="button"
          class="button button-outline"
          :disabled="saving"
          @click="closeModal"
        >
          Cancel</button
        ><button
          class="button button-primary"
          :disabled="saving || photoLoading"
        >
          {{ saving ? "Saving…" : "Save guitar" }}
          <svg class="icon"><use href="#i-arrow" /></svg>
        </button>
      </div>
    </form>
    <form v-else-if="modal === 'setup'" @submit.prevent="submitSetup">
      <p class="modal-intro">
        Make a note of the measurements and modifications that work for you.
      </p>
      <div class="form-grid">
        <label
          >Action<input
            v-model="setupForm.action"
            placeholder="e.g. 1.5 mm at 12th fret"
            autofocus /></label
        ><label
          >Neck relief<input
            v-model="setupForm.relief"
            placeholder="e.g. 0.25 mm" /></label
        ><label class="full-width"
          >Pickup heights<input
            v-model="setupForm.pickupHeights"
            placeholder="e.g. Bass 2.5 mm, treble 2 mm" /></label
        ><label class="full-width"
          >Mods &amp; notes<textarea
            v-model="setupForm.mods"
            rows="4"
            placeholder="Anything else worth remembering"
          ></textarea>
        </label>
      </div>
      <div class="modal-actions">
        <button
          type="button"
          class="button button-outline"
          :disabled="saving"
          @click="closeModal"
        >
          Cancel</button
        ><button class="button button-primary" :disabled="saving">
          {{ saving ? "Saving…" : "Save setup" }}
          <svg class="icon"><use href="#i-arrow" /></svg>
        </button>
      </div>
    </form>
    <form v-else-if="modal === 'strings'" @submit.prevent="submitStrings">
      <p class="modal-intro">
        Keep track of the sets that sound and feel best.
      </p>
      <div class="form-grid">
        <label class="full-width"
          >Date <span class="required">*</span
          ><input
            v-model="stringForm.date"
            type="date"
            required
            autofocus /></label
        ><label
          >Brand <span class="required">*</span
          ><input
            v-model="stringForm.brand"
            required
            maxlength="120"
            placeholder="e.g. D’Addario" /></label
        ><label
          >Gauge <span class="required">*</span
          ><input
            v-model="stringForm.gauge"
            required
            maxlength="120"
            placeholder="e.g. 10–46"
        /></label>
      </div>
      <div class="modal-actions">
        <button
          type="button"
          class="button button-outline"
          :disabled="saving"
          @click="closeModal"
        >
          Cancel</button
        ><button class="button button-primary" :disabled="saving">
          {{ saving ? "Saving…" : "Add change" }}
          <svg class="icon"><use href="#i-arrow" /></svg>
        </button>
      </div>
    </form>
    <div v-else-if="modal === 'delete'">
      <p class="modal-intro">
        This will permanently remove {{ guitarName(selected) }} and its setup
        and string history from this device. This can’t be undone.
      </p>
      <div class="modal-actions">
        <button
          class="button button-outline"
          :disabled="saving"
          @click="closeModal"
        >
          Keep guitar</button
        ><button
          class="button button-danger"
          :disabled="saving"
          @click="removeGuitar"
        >
          {{ saving ? "Removing…" : "Remove guitar" }}
        </button>
      </div>
    </div>
  </dialog>
</template>
