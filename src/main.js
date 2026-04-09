import 'ol/ol.css';
import './style.css';

import Map from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import GeoJSON from 'ol/format/GeoJSON';
import Overlay from 'ol/Overlay';
import { defaults as defaultControls, ScaleLine } from 'ol/control';
import Draw from 'ol/interaction/Draw';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import Cluster from 'ol/source/Cluster';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import { Fill, Stroke, Style, Text, Circle as CircleStyle } from 'ol/style';
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj';
import { createEmpty as createEmptyExtent, extend as extendExtent } from 'ol/extent';
import { getArea, getLength } from 'ol/sphere';

const ROAD_TYPE_LABEL_MAP = {
  highway: '高速公路',
  national: '国道',
  provincial: '省道',
  county: '县道'
};

const ROAD_TYPE_MAP = {
  高速: 'highway',
  高速公路: 'highway',
  国道: 'national',
  省道: 'provincial',
  县道: 'county',
  highway: 'highway',
  national: 'national',
  provincial: 'provincial',
  county: 'county'
};

const DEFAULT_ROAD_STATUS = '畅通';
const DEFAULT_SPEED_LIMIT = 60;
const DEFAULT_CURRENT_SPEED = 0;
const geoserverWfsUrl = import.meta.env.VITE_GEOSERVER_WFS_URL?.trim() || 'http://localhost:8080/geoserver/traffic/wfs';
const geoserverRoadLayer = import.meta.env.VITE_GEOSERVER_ROAD_LAYER?.trim() || 'traffic:Road';
const geoserverPoiLayer = import.meta.env.VITE_GEOSERVER_POI_LAYER?.trim() || 'traffic:poi_all';
const POI_MIN_LOAD_ZOOM = 12.5;
const POI_LABEL_MIN_ZOOM = 14;
const POI_CLUSTER_DISTANCE = 42;
const POI_CLUSTER_MIN_DISTANCE = 0;
const POI_REQUEST_DEBOUNCE_MS = 180;
const POI_CATEGORY_MAP = {
  bus: 'bus',
  bus_stop: 'bus',
  bus_station: 'bus',
  busstation: 'bus',
  '\u516c\u4ea4': 'bus',
  '\u516c\u4ea4\u7ad9': 'bus',
  '\u516c\u4ea4\u7ad9\u70b9': 'bus',
  school: 'school',
  '\u5b66\u6821': 'school',
  hospital: 'hospital',
  '\u533b\u9662': 'hospital'
};
const POI_CATEGORY_LABEL_MAP = {
  bus: '\u516c\u4ea4\u7ad9',
  school: '\u5b66\u6821',
  hospital: '\u533b\u9662'
};
const ROUTE_META = {
  distance: {
    label: '距离最短',
    color: '#2563eb',
    width: 8,
    lineDash: []
  },
  time: {
    label: '时间最短',
    color: '#f97316',
    width: 5,
    lineDash: [16, 10]
  }
};

function repairLikelyGbkMojibake(value) {
  if (typeof value !== 'string' || !/[\u00a0-\u00ff]/.test(value)) {
    return value;
  }

  try {
    const bytes = Uint8Array.from(Array.from(value), (char) => char.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder('gbk', { fatal: false }).decode(bytes);

    return decoded && !decoded.includes('�') ? decoded : value;
  } catch {
    return value;
  }
}

function normalizeRoadType(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = repairLikelyGbkMojibake(value).trim();
  return ROAD_TYPE_MAP[normalizedValue] || null;
}

function normalizeNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizePoiCategory(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = repairLikelyGbkMojibake(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  return POI_CATEGORY_MAP[normalizedValue] || null;
}

function normalizeRoadFeatureCollection(featureCollection) {
  return {
    type: 'FeatureCollection',
    features: (featureCollection?.features || []).map((feature, index) => {
      const properties = feature.properties || {};
      const rawType = properties.roadType ?? properties.type;
      const normalizedRawType =
        typeof rawType === 'string' ? repairLikelyGbkMojibake(rawType).trim() : rawType;
      const roadType = normalizeRoadType(rawType);
      const normalizedName = repairLikelyGbkMojibake(
        properties.name ?? properties.NAME ?? properties.road_name ?? properties.ROAD_NAME ?? ''
      );
      const typeLabel =
        (typeof properties.typeLabel === 'string' && properties.typeLabel.trim()) ||
        (typeof normalizedRawType === 'string' && normalizedRawType) ||
        ROAD_TYPE_LABEL_MAP[roadType] ||
        '未分类';

      return {
        ...feature,
        properties: {
          ...properties,
          roadId: properties.roadId ?? properties.id ?? properties.ROAD_ID ?? feature.id ?? index + 1,
          name: normalizedName || `道路${index + 1}`,
          roadType,
          typeLabel,
          status: properties.status ?? DEFAULT_ROAD_STATUS,
          speedLimit: normalizeNumber(
            properties.speedLimit ?? properties.SPEED_LIMIT ?? properties.maxspeed ?? properties.MAXSPEED,
            DEFAULT_SPEED_LIMIT
          ),
          currentSpeed: normalizeNumber(
            properties.currentSpeed ?? properties.CURRENT_SPEED ?? properties.speed ?? properties.SPEED,
            DEFAULT_CURRENT_SPEED
          )
        }
      };
    })
  };
}

async function loadRoadFeatureCollection() {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '1.1.0',
    request: 'GetFeature',
    typeName: geoserverRoadLayer,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326'
  });

  try {
    const response = await fetch(`${geoserverWfsUrl}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`WFS request failed with ${response.status}`);
    }

    const featureCollection = await response.json();
    const normalizedFeatureCollection = normalizeRoadFeatureCollection(featureCollection);
    const recognizedRoadCount = normalizedFeatureCollection.features.filter(
      (feature) => feature.properties.roadType
    ).length;

    if (!recognizedRoadCount) {
      throw new Error('No recognizable road types were found in WFS data. Check GeoServer attribute encoding.');
    }

    return normalizedFeatureCollection;
  } catch (error) {
    console.error('Failed to load road data from GeoServer WFS.', error);
    return createEmptyFeatureCollection();
  }
}

function createEmptyFeatureCollection() {
  return {
    type: 'FeatureCollection',
    features: []
  };
}

function normalizePoiFeatureCollection(featureCollection) {
  return {
    type: 'FeatureCollection',
    features: (featureCollection?.features || [])
      .map((feature, index) => {
        const properties = feature.properties || {};
        const rawCategory =
          properties.category ??
          properties.category_label ??
          properties.categoryLabel ??
          properties.type ??
          properties.TYPE;
        const category = normalizePoiCategory(rawCategory);
        const normalizedName = repairLikelyGbkMojibake(
          properties.name ?? properties.NAME ?? properties.poi_name ?? properties.POI_NAME ?? ''
        );
        const rawCategoryLabel =
          properties.categoryLabel ??
          properties.category_label ??
          properties.CATEGORY_LABEL ??
          rawCategory;
        const normalizedCategoryLabel =
          typeof rawCategoryLabel === 'string' ? repairLikelyGbkMojibake(rawCategoryLabel).trim() : '';

        return {
          ...feature,
          properties: {
            ...properties,
            poiId:
              properties.poiId ??
              properties.poi_id ??
              properties.id ??
              properties.POI_ID ??
              feature.id ??
              index + 1,
            name: normalizedName || `POI ${index + 1}`,
            category,
            categoryLabel: normalizedCategoryLabel || POI_CATEGORY_LABEL_MAP[category] || 'Unclassified'
          }
        };
      })
      .filter((feature) => feature?.geometry?.type === 'Point' && feature.properties.category)
  };
}

async function loadPoiFeatureCollection(extent4326) {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '1.1.0',
    request: 'GetFeature',
    typeName: geoserverPoiLayer,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    propertyName: 'poi_id,name,category,category_label,geom'
  });

  if (extent4326) {
    const [minX, minY, maxX, maxY] = extent4326;
    params.set('cql_filter', `BBOX(geom,${minX},${minY},${maxX},${maxY},'EPSG:4326')`);
  }

  try {
    const fullUrl = `${geoserverWfsUrl}?${params.toString()}`;
    const response = await fetch(fullUrl);
    if (!response.ok) {
      throw new Error(`WFS request failed with ${response.status}`);
    }

    const featureCollection = await response.json();
    const normalizedFeatureCollection = normalizePoiFeatureCollection(featureCollection);
    return normalizedFeatureCollection;
  } catch (error) {
    console.error('Failed to load POI data from GeoServer WFS.', error);
    return createEmptyFeatureCollection();
  }
}

function getLayerCounts(roadFeatureCollection, poiFeatureCollection) {
  return {
    highway: roadFeatureCollection.features.filter((feature) => feature.properties.roadType === 'highway').length,
    national: roadFeatureCollection.features.filter((feature) => feature.properties.roadType === 'national').length,
    provincial: roadFeatureCollection.features.filter((feature) => feature.properties.roadType === 'provincial').length,
    county: roadFeatureCollection.features.filter((feature) => feature.properties.roadType === 'county').length,
    bus: poiFeatureCollection.features.filter((feature) => feature.properties.category === 'bus').length,
    school: poiFeatureCollection.features.filter((feature) => feature.properties.category === 'school').length,
    hospital: poiFeatureCollection.features.filter((feature) => feature.properties.category === 'hospital').length
  };
}

const app = document.querySelector('#app');
let roadFeatureCollection = createEmptyFeatureCollection();
let poiFeatureCollection = createEmptyFeatureCollection();
let allPoiFeatureCollection = createEmptyFeatureCollection();
let LAYER_COUNTS = getLayerCounts(roadFeatureCollection, allPoiFeatureCollection);

app.innerHTML = `
  <div class="dashboard-shell">
    <header class="topbar slim-topbar">
      <div class="topbar-left">
        <button id="sidebar-toggle" class="sidebar-toggle" type="button" aria-label="切换侧边栏">☰</button>
        <div class="title-stack">
          <h1>北京市交通地理信息系统</h1>
        </div>
      </div>
      <div class="topbar-right">
        <div class="clock-inline">
          <strong id="clock-time">--:--:--</strong>
          <span id="clock-date">----</span>
        </div>
      </div>
    </header>

    <main class="workspace">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-rail">
          <button class="rail-button is-active" data-panel="layers" type="button">
            <span class="rail-icon">图</span>
            <span class="rail-label">图层</span>
          </button>
          <button class="rail-button" data-panel="query" type="button">
            <span class="rail-icon">查</span>
            <span class="rail-label">查询</span>
          </button>
          <button class="rail-button" data-panel="route" type="button">
            <span class="rail-icon">路</span>
            <span class="rail-label">路径</span>
          </button>
          <button class="rail-button" data-panel="monitor" type="button">
            <span class="rail-icon">监</span>
            <span class="rail-label">监控</span>
          </button>
        </div>

        <div class="sidebar-drawer">
          <div class="drawer-header">
            <h2 id="drawer-title">图层控制</h2>
            <span id="status-base" class="drawer-chip">底图：无底图</span>
          </div>

          <div class="panel-stack">
            <section class="panel-view is-active" data-panel-view="layers">
              <div class="mini-section">
                <div class="subsection-title">道路网络</div>
                <div class="layer-group">
                  <label class="layer-row">
                    <span class="layer-main">
                      <span class="layer-swatch road-highway"></span>
                      <span class="layer-name">高速公路</span>
                    </span>
                    <span class="layer-side">
                      <span class="layer-count">${LAYER_COUNTS.highway}条</span>
                      <input class="layer-toggle" type="checkbox" data-layer="highway" checked />
                    </span>
                  </label>
                  <label class="layer-row">
                    <span class="layer-main">
                      <span class="layer-swatch road-national"></span>
                      <span class="layer-name">国道</span>
                    </span>
                    <span class="layer-side">
                      <span class="layer-count">${LAYER_COUNTS.national}条</span>
                      <input class="layer-toggle" type="checkbox" data-layer="national" checked />
                    </span>
                  </label>
                  <label class="layer-row">
                    <span class="layer-main">
                      <span class="layer-swatch road-provincial"></span>
                      <span class="layer-name">省道</span>
                    </span>
                    <span class="layer-side">
                      <span class="layer-count">${LAYER_COUNTS.provincial}条</span>
                      <input class="layer-toggle" type="checkbox" data-layer="provincial" checked />
                    </span>
                  </label>
                  <label class="layer-row">
                    <span class="layer-main">
                      <span class="layer-swatch road-county"></span>
                      <span class="layer-name">县道</span>
                    </span>
                    <span class="layer-side">
                      <span class="layer-count">${LAYER_COUNTS.county}条</span>
                      <input class="layer-toggle" type="checkbox" data-layer="county" checked />
                    </span>
                  </label>
                </div>
              </div>

              <div class="mini-section">
                <div class="subsection-title">兴趣点图层</div>
                <div class="layer-group">
                  <label class="layer-row">
                    <span class="layer-main">
                      <span class="layer-dot poi-bus"></span>
                      <span class="layer-name">公交站</span>
                    </span>
                    <span class="layer-side">
                      <span class="layer-count">${LAYER_COUNTS.bus}处</span>
                      <input class="layer-toggle" type="checkbox" data-layer="bus" />
                    </span>
                  </label>
                  <label class="layer-row">
                    <span class="layer-main">
                      <span class="layer-dot poi-school"></span>
                      <span class="layer-name">学校</span>
                    </span>
                    <span class="layer-side">
                      <span class="layer-count">${LAYER_COUNTS.school}处</span>
                      <input class="layer-toggle" type="checkbox" data-layer="school" />
                    </span>
                  </label>
                  <label class="layer-row">
                    <span class="layer-main">
                      <span class="layer-dot poi-hospital"></span>
                      <span class="layer-name">医院</span>
                    </span>
                    <span class="layer-side">
                      <span class="layer-count">${LAYER_COUNTS.hospital}处</span>
                      <input class="layer-toggle" type="checkbox" data-layer="hospital" />
                    </span>
                  </label>
                </div>
              </div>

              <div class="mini-section">
                <div class="subsection-title">地图测算</div>
                <div class="tool-button-grid">
                  <button class="tool-button" data-mode="measure-length">测距</button>
                  <button class="tool-button" data-mode="measure-area">测面积</button>
                </div>
              </div>

              <div class="route-actions">
                <button id="clear-measure-btn" class="ghost-action">清除绘制</button>
              </div>

              <div class="measure-banner" id="layers-measure-banner">量测结果显示区</div>
            </section>

            <section class="panel-view" data-panel-view="query">
              <div class="mini-section">
                <div class="subsection-title">搜索</div>
                <form id="search-form" class="search-form">
                  <input id="search-input" type="text" placeholder="道路或兴趣点名称" />
                  <button type="submit">查询</button>
                </form>
              </div>

              <div class="mini-section">
                <div class="subsection-title">结果</div>
                <div class="search-results" id="search-results"></div>
              </div>

              <div class="feature-card">
                <div class="subsection-title">详情</div>
                <div id="feature-detail" class="feature-detail empty-state">点击地图要素后显示属性。</div>
              </div>
            </section>

            <section class="panel-view" data-panel-view="route">
              <div class="mini-section">
                <div class="subsection-title">模式</div>
                <div class="tool-button-grid">
                  <button class="tool-button is-active" data-mode="query">查询</button>
                  <button class="tool-button" data-mode="start">起点</button>
                  <button class="tool-button" data-mode="end">终点</button>
                  <button class="tool-button" data-mode="measure-length">测距</button>
                  <button class="tool-button" data-mode="measure-area">测面</button>
                </div>
              </div>

              <div class="route-actions">
                <button id="build-route-btn" class="primary-action">生成路径</button>
                <button id="clear-route-btn" class="ghost-action">清空</button>
              </div>

              <div class="route-summary" id="route-summary">
                <div class="summary-row"><span>起点</span><strong>未设置</strong></div>
                <div class="summary-row"><span>终点</span><strong>未设置</strong></div>
                <div class="summary-row"><span>长度</span><strong>--</strong></div>
                <div class="summary-row"><span>耗时</span><strong>--</strong></div>
              </div>

              <div class="measure-banner" id="measure-banner">量测结果显示区</div>
            </section>

            <section class="panel-view" data-panel-view="monitor">
              <div class="mini-section">
                <div class="subsection-title">路况信息</div>
                <div class="empty-state monitor-empty-state">暂无实时路况数据。</div>
              </div>
            </section>
          </div>

          <footer class="sidebar-footer">
            <span id="status-mode">模式：查询</span>
          </footer>
        </div>
      </aside>

      <section class="map-workspace">
        <div class="map-frame">
          <div id="map" class="map-container"></div>

          <div class="map-float-card overlay-top-left zoom-float">
            <button id="zoom-in-btn" class="zoom-button" type="button">+</button>
            <button id="zoom-out-btn" class="zoom-button" type="button">-</button>
          </div>

          <div class="map-float-card overlay-top-right base-switch-float">
            <div class="base-switch-grid">
              <button class="base-button is-active" data-base="none">无底图</button>
              <button class="base-button" data-base="tdtVector">天地图矢量</button>
              <button class="base-button" data-base="tdtImage">天地图影像</button>
            </div>
          </div>

          <div class="map-float-card overlay-bottom-left legend-float-card">
            <div class="subsection-title">道路图例</div>
            <div class="legend-list road-legend-list">
              <div class="legend-item"><span class="layer-swatch road-highway"></span><span>高速公路</span></div>
              <div class="legend-item"><span class="layer-swatch road-national"></span><span>国道</span></div>
              <div class="legend-item"><span class="layer-swatch road-provincial"></span><span>省道</span></div>
              <div class="legend-item"><span class="layer-swatch road-county"></span><span>县道</span></div>
            </div>
          </div>

          <div class="map-float-card overlay-bottom-right compact-info-card">
            <div id="mode-indicator" class="mode-indicator">查询模式</div>
            <div id="coord-indicator" class="coord-indicator">经纬度：--, --</div>
          </div>

          <div id="popup" class="map-popup">
            <button id="popup-closer" class="popup-close" type="button">×</button>
            <div id="popup-content"></div>
          </div>
        </div>
      </section>
    </main>
  </div>
`;

const ROAD_TYPE_META = {
  highway: { label: '高速公路', width: 8, color: '#1d4ed8' },
  national: { label: '国道', width: 7, color: '#7c3aed' },
  provincial: { label: '省道', width: 6, color: '#2563eb' },
  county: { label: '县道', width: 5, color: '#0f766e' }
};

const POI_META = {
  bus: { label: '公交站', color: '#0ea5e9', text: '站' },
  school: { label: '学校', color: '#8b5cf6', text: '学' },
  hospital: { label: '医院', color: '#dc2626', text: '医' }
};

const MODE_LABELS = {
  query: '查询模式',
  start: '起点选取',
  end: '终点选取',
  'measure-length': '距离量测',
  'measure-area': '面积量测'
};

const refs = {
  sidebar: document.querySelector('#sidebar'),
  sidebarToggle: document.querySelector('#sidebar-toggle'),
  drawerTitle: document.querySelector('#drawer-title'),
  clockTime: document.querySelector('#clock-time'),
  clockDate: document.querySelector('#clock-date'),
  featureDetail: document.querySelector('#feature-detail'),
  searchForm: document.querySelector('#search-form'),
  searchInput: document.querySelector('#search-input'),
  searchResults: document.querySelector('#search-results'),
  routeSummary: document.querySelector('#route-summary'),
  buildRouteButton: document.querySelector('#build-route-btn'),
  clearRouteButton: document.querySelector('#clear-route-btn'),
  measureBanner: document.querySelector('#measure-banner'),
  layersMeasureBanner: document.querySelector('#layers-measure-banner'),
  modeIndicator: document.querySelector('#mode-indicator'),
  coordIndicator: document.querySelector('#coord-indicator'),
  popup: document.querySelector('#popup'),
  popupContent: document.querySelector('#popup-content'),
  popupCloser: document.querySelector('#popup-closer'),
  statusMode: document.querySelector('#status-mode'),
  statusBase: document.querySelector('#status-base'),
  zoomInButton: document.querySelector('#zoom-in-btn'),
  zoomOutButton: document.querySelector('#zoom-out-btn')
};

const PANEL_TITLES = {
  layers: '图层控制',
  query: '综合查询',
  route: '路径分析',
  monitor: '态势监控'
};

const geoJsonFormat = new GeoJSON();
let roadFeatures = geoJsonFormat.readFeatures(roadFeatureCollection, {
  dataProjection: 'EPSG:4326',
  featureProjection: 'EPSG:3857'
});
let poiFeatures = geoJsonFormat.readFeatures(poiFeatureCollection, {
  dataProjection: 'EPSG:4326',
  featureProjection: 'EPSG:3857'
});

const state = {
  currentMode: 'query',
  activeBase: 'none',
  drawInteraction: null,
  routeStart: null,
  routeEnd: null,
  routes: []
};

const roadLayers = {};
const poiSources = {};
const poiLayers = {};
const poiRuntime = {
  debounceTimer: null,
  latestRequestId: 0,
  latestRequestKey: '',
  isLoading: false
};

function buildTileSource(url) {
  return new XYZ({
    urls: ['0', '1', '2', '3'].map((index) => url.replace('{s}', index)),
    crossOrigin: 'anonymous'
  });
}

const tdtKey = import.meta.env.VITE_TDT_KEY?.trim();
const hasTdtKey = Boolean(tdtKey);

const baseLayers = {
  none: new VectorLayer({
    source: new VectorSource(),
    visible: true
  }),
  tdtVector: new TileLayer({
    source: hasTdtKey
      ? buildTileSource(
          `https://t{s}.tianditu.gov.cn/DataServer?T=vec_w&x={x}&y={y}&l={z}&tk=${tdtKey}`
        )
      : undefined,
    visible: false
  }),
  tdtImage: new TileLayer({
    source: hasTdtKey
      ? buildTileSource(
          `https://t{s}.tianditu.gov.cn/DataServer?T=img_w&x={x}&y={y}&l={z}&tk=${tdtKey}`
        )
      : undefined,
    visible: false
  })
};

Object.entries(ROAD_TYPE_META).forEach(([roadType, meta]) => {
  const source = new VectorSource({
    features: roadFeatures.filter((feature) => feature.get('roadType') === roadType)
  });

  roadLayers[roadType] = new VectorLayer({
    source,
    style: (feature) => createRoadStyle(feature, meta)
  });
});

Object.entries(POI_META).forEach(([category, meta]) => {
  const source = new VectorSource({
    features: poiFeatures.filter((feature) => feature.get('category') === category)
  });
  const clusterSource = new Cluster({
    distance: POI_CLUSTER_DISTANCE,
    minDistance: POI_CLUSTER_MIN_DISTANCE,
    source
  });

  poiSources[category] = source;

  poiLayers[category] = new VectorLayer({
    source: clusterSource,
    declutter: true,
    minZoom: POI_MIN_LOAD_ZOOM,
    visible: false,
    zIndex: 30,
    style: createPoiStyle(meta)
  });
});

const routeSources = {
  distance: new VectorSource(),
  time: new VectorSource()
};
const markerSource = new VectorSource();
const selectionSource = new VectorSource();
const measureSource = new VectorSource();

const routeLayers = {
  distance: new VectorLayer({
    source: routeSources.distance,
    style: new Style({
      stroke: new Stroke({
        color: ROUTE_META.distance.color,
        width: ROUTE_META.distance.width
      })
    })
  }),
  time: new VectorLayer({
    source: routeSources.time,
    style: new Style({
      stroke: new Stroke({
        color: ROUTE_META.time.color,
        width: ROUTE_META.time.width,
        lineDash: ROUTE_META.time.lineDash
      })
    })
  })
};

const markerLayer = new VectorLayer({
  source: markerSource,
  style: createMarkerStyle
});

const selectionLayer = new VectorLayer({
  source: selectionSource,
  style: createSelectionStyle
});

const measureLayer = new VectorLayer({
  source: measureSource,
  style: new Style({
    fill: new Fill({
      color: 'rgba(56, 189, 248, 0.18)'
    }),
    stroke: new Stroke({
      color: '#38bdf8',
      width: 3,
      lineDash: [10, 8]
    })
  })
});

const popupOverlay = new Overlay({
  element: refs.popup,
  autoPan: {
    animation: {
      duration: 250
    }
  },
  offset: [0, -18],
  positioning: 'bottom-center'
});

const map = new Map({
  target: 'map',
  controls: defaultControls({
    zoom: false,
    attribution: false
  }).extend([new ScaleLine()]),
  layers: [
    baseLayers.none,
    baseLayers.tdtVector,
    baseLayers.tdtImage,
    ...Object.values(roadLayers),
    ...Object.values(poiLayers),
    ...Object.values(routeLayers),
    markerLayer,
    selectionLayer,
    measureLayer
  ],
  overlays: [popupOverlay],
  view: new View({
    center: fromLonLat([116.4074, 39.9042]),
    zoom: 10.8,
    minZoom: 8,
    maxZoom: 18
  })
});

initializeClock();
initializeControls();
renderRouteSummary();
applyTdtAvailability();
updateMode('query');
updateZoomStatus();
hydrateMapData();

map.on('pointermove', (event) => {
  if (event.dragging) {
    return;
  }

  const [lon, lat] = toLonLat(event.coordinate);
  refs.coordIndicator.textContent = `经纬度：${lon.toFixed(5)}, ${lat.toFixed(5)}`;
});

map.on('singleclick', (event) => {
  const lonLat = toLonLat(event.coordinate);

  if (state.currentMode === 'start') {
    state.routeStart = lonLat;
    updateMarkers();
    renderRouteSummary();
    return;
  }

  if (state.currentMode === 'end') {
    state.routeEnd = lonLat;
    updateMarkers();
    renderRouteSummary();
    return;
  }

  if (state.currentMode !== 'query') {
    return;
  }

  const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate);
  if (!feature) {
    clearSelection();
    return;
  }

  const clusteredFeatures = feature.get('features');
  if (Array.isArray(clusteredFeatures) && clusteredFeatures.length > 1) {
    const view = map.getView();
    const canZoomFurther = (view.getZoom() ?? 0) < (view.getMaxZoom() ?? 18);

    if (canZoomFurther && hasMultipleClusterLocations(clusteredFeatures)) {
      view.animate({
        center: event.coordinate,
        zoom: Math.min((view.getZoom() ?? POI_MIN_LOAD_ZOOM) + 2, view.getMaxZoom()),
        duration: 250
      });
    } else {
      focusClusterMembers(clusteredFeatures, event.coordinate);
    }
    return;
  }

  const targetFeature =
    Array.isArray(clusteredFeatures) && clusteredFeatures.length === 1 ? clusteredFeatures[0] : feature;

  focusFeature(targetFeature, event.coordinate);
});

map.getView().on('change:resolution', updateZoomStatus);
map.on('moveend', () => {
  schedulePoiRefresh();
});

function initializeClock() {
  const updateClock = () => {
    const now = new Date();
    refs.clockTime.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
    refs.clockDate.textContent = now.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  };

  updateClock();
  window.setInterval(updateClock, 1000);
}

function initializeControls() {
  document.querySelectorAll('[data-panel]').forEach((button) => {
    button.addEventListener('click', () => {
      switchPanel(button.dataset.panel);
    });
  });

  refs.sidebarToggle.addEventListener('click', () => {
    refs.sidebar.classList.toggle('is-collapsed');
  });

  document.querySelectorAll('[data-base]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextBase = button.dataset.base;
      if (!hasTdtKey && nextBase !== 'none') {
        refs.measureBanner.textContent = '天地图底图未启用，请在 .env 中配置 VITE_TDT_KEY。';
        return;
      }

      switchBaseLayer(nextBase);
    });
  });

  document.querySelectorAll('[data-layer]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const key = checkbox.dataset.layer;
      if (roadLayers[key]) {
        roadLayers[key].setVisible(checkbox.checked);
      }
      if (poiLayers[key]) {
        poiLayers[key].setVisible(checkbox.checked);
      }
    });
  });

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => updateMode(button.dataset.mode));
  });

  refs.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch(refs.searchInput.value.trim());
  });

  refs.searchResults.addEventListener('click', (event) => {
    const target = event.target.closest('[data-feature-type]');
    if (!target) {
      return;
    }

    const feature = findFeature(target.dataset.featureType, target.dataset.featureId);
    if (!feature) {
      return;
    }

    const geometry = feature.getGeometry();
    const coordinate =
      geometry.getType() === 'Point'
        ? geometry.getCoordinates()
        : geometry.getClosestPoint(map.getView().getCenter());

    focusFeature(feature, coordinate);
    map.getView().animate({
      center: coordinate,
      zoom: 12.5,
      duration: 500
    });
  });

  refs.popupContent.addEventListener('click', (event) => {
    const target = event.target.closest('[data-feature-type]');
    if (!target) {
      return;
    }

    const feature = findFeature(target.dataset.featureType, target.dataset.featureId);
    if (!feature) {
      return;
    }

    const geometry = feature.getGeometry();
    const coordinate =
      geometry.getType() === 'Point'
        ? geometry.getCoordinates()
        : geometry.getClosestPoint(map.getView().getCenter());

    focusFeature(feature, coordinate);
    map.getView().animate({
      center: coordinate,
      zoom: Math.max(map.getView().getZoom() ?? POI_LABEL_MIN_ZOOM, POI_LABEL_MIN_ZOOM),
      duration: 300
    });
  });

  refs.buildRouteButton.addEventListener('click', buildRoute);
  refs.clearRouteButton.addEventListener('click', clearRoute);
  document.querySelector('#clear-measure-btn').addEventListener('click', clearMeasure);
  refs.popupCloser.addEventListener('click', () => popupOverlay.setPosition(undefined));

  refs.zoomInButton.addEventListener('click', () => {
    map.getView().animate({ zoom: map.getView().getZoom() + 1, duration: 250 });
  });

  refs.zoomOutButton.addEventListener('click', () => {
    map.getView().animate({ zoom: map.getView().getZoom() - 1, duration: 250 });
  });
}

function switchPanel(panelName) {
  document.querySelectorAll('[data-panel]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.panel === panelName);
  });

  document.querySelectorAll('[data-panel-view]').forEach((view) => {
    view.classList.toggle('is-active', view.dataset.panelView === panelName);
  });

  refs.drawerTitle.textContent = PANEL_TITLES[panelName];

  if (refs.sidebar.classList.contains('is-collapsed')) {
    refs.sidebar.classList.remove('is-collapsed');
  }
}

function applyTdtAvailability() {
  if (!hasTdtKey) {
    document.querySelectorAll('[data-base="tdtVector"], [data-base="tdtImage"]').forEach((button) => {
      button.classList.add('is-disabled');
    });
  }
}

function switchBaseLayer(baseKey) {
  Object.entries(baseLayers).forEach(([key, layer]) => {
    layer.setVisible(key === baseKey);
  });

  state.activeBase = baseKey;

  document.querySelectorAll('[data-base]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.base === baseKey);
  });

  const labelMap = {
    none: '无底图',
    tdtVector: '天地图矢量',
    tdtImage: '天地图影像'
  };

  refs.statusBase.textContent = `底图：${labelMap[baseKey]}`;
}

function updateMode(mode) {
  state.currentMode = mode;
  clearDrawInteraction();

  if (mode === 'measure-length') {
    enableMeasureInteraction('LineString');
  }

  if (mode === 'measure-area') {
    enableMeasureInteraction('Polygon');
  }

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === mode);
  });

  refs.modeIndicator.textContent = MODE_LABELS[mode];
  refs.statusMode.textContent = `模式：${MODE_LABELS[mode]}`;
}

function enableMeasureInteraction(drawType) {
  state.drawInteraction = new Draw({
    source: measureSource,
    type: drawType
  });

  state.drawInteraction.on('drawend', (event) => {
    const geometry = event.feature.getGeometry();
    const clone = geometry.clone().transform('EPSG:3857', 'EPSG:4326');

    if (clone instanceof LineString) {
      const result = `测距结果：${formatDistance(
        getLength(clone, { projection: 'EPSG:4326' })
      )}`;
      refs.measureBanner.textContent = result;
      if (refs.layersMeasureBanner) {
        refs.layersMeasureBanner.textContent = result;
      }
    }

    if (clone instanceof Polygon) {
      const result = `测面结果：${formatArea(
        getArea(clone, { projection: 'EPSG:4326' })
      )}`;
      refs.measureBanner.textContent = result;
      if (refs.layersMeasureBanner) {
        refs.layersMeasureBanner.textContent = result;
      }
    }
  });

  map.addInteraction(state.drawInteraction);
}

function clearDrawInteraction() {
  if (!state.drawInteraction) {
    return;
  }

  map.removeInteraction(state.drawInteraction);
  state.drawInteraction = null;
}

function runSearch(keyword) {
  if (!keyword) {
    refs.searchResults.innerHTML = '<div class="empty-state">请输入关键字后再查询。</div>';
    return;
  }

  const value = keyword.toLowerCase();
  
  // 转换allPoiFeatureCollection为features数组，用于搜索
  const allPoiFeatures = geoJsonFormat.readFeatures(allPoiFeatureCollection, {
    dataProjection: 'EPSG:4326',
    featureProjection: 'EPSG:3857'
  });
  
  const matches = [
    ...roadFeatures
      .filter((feature) => String(feature.get('name') || '').toLowerCase().includes(value))
      .map((feature) => ({
        type: 'road',
        id: feature.get('roadId'),
        name: feature.get('name'),
        extra: feature.get('typeLabel')
      })),
    ...allPoiFeatures
      .filter((feature) => String(feature.get('name') || '').toLowerCase().includes(value))
      .map((feature) => ({
        type: 'poi',
        id: feature.get('poiId'),
        name: feature.get('name'),
        extra: feature.get('categoryLabel')
      }))
  ];

  if (!matches.length) {
    refs.searchResults.innerHTML =
      '<div class="empty-state">未找到匹配结果，可尝试输入 京藏高速、京承高速、北京交通大学 等关键词。</div>';
    return;
  }

  refs.searchResults.innerHTML = matches
    .map(
      (match) => `
        <button class="result-item" type="button" data-feature-type="${match.type}" data-feature-id="${match.id}">
          <span>${match.name}</span>
          <strong>${match.extra}</strong>
        </button>
      `
    )
    .join('');
}

function findFeature(type, id) {
  if (type === 'road') {
    return roadFeatures.find((feature) => String(feature.get('roadId')) === String(id));
  }

  if (type === 'poi') {
    // 先在当前视图的POI中查找
    let feature = poiFeatures.find((feature) => String(feature.get('poiId')) === String(id));
    if (feature) {
      return feature;
    }
    
    // 如果没找到，在所有POI中查找
    const allPoiFeatures = geoJsonFormat.readFeatures(allPoiFeatureCollection, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857'
    });
    return allPoiFeatures.find((feature) => String(feature.get('poiId')) === String(id));
  }

  return null;
}

function hasMultipleClusterLocations(features) {
  const coordinateKeys = new Set(
    features
      .map((feature) => feature.getGeometry()?.getCoordinates?.())
      .filter((coordinate) => Array.isArray(coordinate) && coordinate.length >= 2)
      .map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`)
  );

  return coordinateKeys.size > 1;
}

function renderClusterMemberButtons(features) {
  return features
    .map((feature) => {
      const properties = feature.getProperties();
      return `
        <button class="result-item cluster-member-item" type="button" data-feature-type="poi" data-feature-id="${properties.poiId}">
          <span>${properties.name}</span>
          <strong>${properties.categoryLabel}</strong>
        </button>
      `;
    })
    .join('');
}

function focusClusterMembers(features, coordinate) {
  const content = renderClusterMemberButtons(features);

  selectionSource.clear();
  refs.featureDetail.className = 'feature-detail';
  refs.featureDetail.innerHTML = `
    <div class="detail-title">聚合兴趣点</div>
    <div class="detail-note">当前层级仍有 ${features.length} 个兴趣点重叠，请点击下方条目查看详情。</div>
    <div class="search-results cluster-member-list">${content}</div>
  `;
  refs.popupContent.innerHTML = `
    <div class="popup-title">聚合兴趣点</div>
    <div class="popup-row">共 ${features.length} 个兴趣点</div>
    <div class="search-results cluster-member-list">${content}</div>
  `;
  popupOverlay.setPosition(coordinate);
}

function focusFeature(feature, coordinate) {
  selectionSource.clear();
  selectionSource.addFeature(feature.clone());

  const geometry = feature.getGeometry();
  const properties = feature.getProperties();

  refs.featureDetail.className = 'feature-detail';

  if (geometry.getType() !== 'Point') {
    refs.featureDetail.innerHTML = `
      <div class="detail-title">${properties.name}</div>
      <div class="detail-grid">
        <div><span>类型</span><strong>${properties.typeLabel}</strong></div>
        <div><span>编号</span><strong>${properties.roadId}</strong></div>
      </div>
      <div class="detail-note">实时路况信息请在“监控”面板查看。</div>
    `;
    refs.popupContent.innerHTML = `
      <div class="popup-title">${properties.name}</div>
      <div class="popup-row">道路类型：${properties.typeLabel}</div>
      <div class="popup-row">道路编号：${properties.roadId}</div>
    `;
  } else {
    refs.featureDetail.innerHTML = `
      <div class="detail-title">${properties.name}</div>
      <div class="detail-grid">
        <div><span>类别</span><strong>${properties.categoryLabel}</strong></div>
      </div>
    `;
    refs.popupContent.innerHTML = `
      <div class="popup-title">${properties.name}</div>
      <div class="popup-row">兴趣点类别：${properties.categoryLabel}</div>
    `;
  }

  popupOverlay.setPosition(coordinate);
}

function clearSelection() {
  selectionSource.clear();
  popupOverlay.setPosition(undefined);
  refs.featureDetail.className = 'feature-detail empty-state';
  refs.featureDetail.textContent = '点击地图要素后，这里显示道路或 POI 的详细属性。';
}

function updateMarkers() {
  markerSource.clear();

  if (state.routeStart) {
    markerSource.addFeature(
      new Feature({
        geometry: new Point(fromLonLat(state.routeStart)),
        role: 'start'
      })
    );
  }

  if (state.routeEnd) {
    markerSource.addFeature(
      new Feature({
        geometry: new Point(fromLonLat(state.routeEnd)),
        role: 'end'
      })
    );
  }
}

async function buildRoute() {
  if (!state.routeStart || !state.routeEnd) {
    refs.measureBanner.textContent = '请先在地图上分别设置起点与终点。';
    return;
  }

  Object.values(routeSources).forEach((source) => source.clear());
  state.routes = [];
  renderRouteSummary();
  refs.measureBanner.textContent = '正在规划路径...';

  try {
    const routeData = await fetchRouteData(state.routeStart, state.routeEnd);
    state.routes = routeData.routes;

    if (!state.routes.length) {
      throw new Error('未返回有效路径');
    }

    state.routes.forEach((route) => {
      const transformedCoordinates = route.coordinates.map((coordinate) => fromLonLat(coordinate));
      routeSources[route.key].addFeature(
        new Feature({
          geometry: new LineString(transformedCoordinates),
          routeKey: route.key
        })
      );
    });

    renderRouteSummary();
    fitRouteFeatures();
    refs.measureBanner.textContent = '路径规划完成。';
  } catch (error) {
    console.error('路径规划失败:', error);
    state.routes = [];
    renderRouteSummary();
    refs.measureBanner.textContent = '路径规划失败，请检查路径服务和路网数据。';
  }
}

function fitRouteFeatures() {
  const extent = createEmptyExtent();
  let hasFeature = false;

  Object.values(routeSources).forEach((source) => {
    source.getFeatures().forEach((feature) => {
      extendExtent(extent, feature.getGeometry().getExtent());
      hasFeature = true;
    });
  });

  if (hasFeature) {
    map.getView().fit(extent, {
      padding: [120, 120, 120, 120],
      duration: 600
    });
  }
}

function areSameCoordinate(left, right, tolerance = 1e-9) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length < 2 || right.length < 2) {
    return false;
  }

  return Math.abs(left[0] - right[0]) <= tolerance && Math.abs(left[1] - right[1]) <= tolerance;
}

function normalizeRouteCoordinates(coordinates) {
  const normalized = [];

  coordinates.forEach((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      return;
    }

    const cleanCoordinate = [Number(coordinate[0]), Number(coordinate[1])];
    if (!Number.isFinite(cleanCoordinate[0]) || !Number.isFinite(cleanCoordinate[1])) {
      return;
    }

    if (!normalized.length || !areSameCoordinate(normalized[normalized.length - 1], cleanCoordinate)) {
      normalized.push(cleanCoordinate);
    }
  });

  return normalized;
}

function appendRouteSegment(target, segment) {
  const normalizedSegment = normalizeRouteCoordinates(segment);
  if (!normalizedSegment.length) {
    return;
  }

  if (!target.length) {
    target.push(...normalizedSegment);
    return;
  }

  const lastCoordinate = target[target.length - 1];
  const startDistance =
    Math.pow(lastCoordinate[0] - normalizedSegment[0][0], 2) +
    Math.pow(lastCoordinate[1] - normalizedSegment[0][1], 2);
  const endDistance =
    Math.pow(lastCoordinate[0] - normalizedSegment[normalizedSegment.length - 1][0], 2) +
    Math.pow(lastCoordinate[1] - normalizedSegment[normalizedSegment.length - 1][1], 2);
  const orientedSegment = endDistance < startDistance ? [...normalizedSegment].reverse() : normalizedSegment;

  orientedSegment.forEach((coordinate) => {
    if (!areSameCoordinate(target[target.length - 1], coordinate)) {
      target.push(coordinate);
    }
  });
}

function extractRouteCoordinates(routeGeometry) {
  if (!routeGeometry) {
    return [];
  }

  if (routeGeometry.type === 'LineString') {
    return normalizeRouteCoordinates(routeGeometry.coordinates ?? []);
  }

  if (routeGeometry.type === 'MultiLineString') {
    const coordinates = [];
    (routeGeometry.coordinates ?? []).forEach((segment) => {
      appendRouteSegment(coordinates, segment);
    });
    return coordinates;
  }

  if (routeGeometry.type === 'GeometryCollection') {
    const coordinates = [];
    (routeGeometry.geometries ?? []).forEach((geometry) => {
      appendRouteSegment(coordinates, extractRouteCoordinates(geometry));
    });
    return coordinates;
  }

  return [];
}

async function fetchRouteData(start, end) {
  const response = await fetch(
    `http://localhost:5000/api/multi-route?start_lon=${start[0]}&start_lat=${start[1]}&end_lon=${end[0]}&end_lat=${end[1]}`
  );

  if (!response.ok) {
    throw new Error(`路径规划请求失败: ${response.status}`);
  }

  const data = await response.json();
  if (data.status !== 'success' || !Array.isArray(data.routes) || data.routes.length === 0) {
    throw new Error('路径规划服务未返回有效结果');
  }

  return {
    routes: data.routes
      .map((route) => {
        const coordinates = extractRouteCoordinates(route.route);
        const fallbackDistance =
          coordinates.length > 1
            ? getLength(new LineString(coordinates), { projection: 'EPSG:4326' })
            : null;

        return {
          key: route.route_key,
          label: route.label || ROUTE_META[route.route_key]?.label || '路径结果',
          coordinates,
          distance: normalizeNumber(route.distance, fallbackDistance),
          duration: normalizeNumber(route.duration, null),
          avgSpeed: normalizeNumber(route.avg_speed, null)
        };
      })
      .filter((route) => routeSources[route.key] && route.coordinates.length > 1)
  };
}

function clearRoute() {
  state.routeStart = null;
  state.routeEnd = null;
  state.routes = [];
  Object.values(routeSources).forEach((source) => source.clear());
  markerSource.clear();
  measureSource.clear();
  renderRouteSummary();
  refs.measureBanner.textContent = '路径与量测结果已清空';
  if (refs.layersMeasureBanner) {
    refs.layersMeasureBanner.textContent = '量测结果显示区';
  }
}

function clearMeasure() {
  measureSource.clear();
  refs.measureBanner.textContent = '量测结果显示区';
  if (refs.layersMeasureBanner) {
    refs.layersMeasureBanner.textContent = '量测结果显示区';
  }
  updateMode('query');
}

function renderRouteSummary() {
  const compareCards = state.routes.length
    ? state.routes
        .map((route) => {
          const meta = ROUTE_META[route.key] || {};
          const distanceText = Number.isFinite(route.distance) ? formatDistance(route.distance) : '--';
          const durationText = Number.isFinite(route.duration) ? formatDuration(route.duration) : '--';
          const avgSpeedText = Number.isFinite(route.avgSpeed) ? `${route.avgSpeed.toFixed(1)} km/h` : '--';

          return `
            <article class="route-compare-card">
              <div class="route-compare-head">
                <span class="route-compare-chip" style="--route-color: ${meta.color || '#2563eb'}"></span>
                <strong>${route.label}</strong>
              </div>
              <div class="route-compare-row"><span>路径长度</span><strong>${distanceText}</strong></div>
              <div class="route-compare-row"><span>预计耗时</span><strong>${durationText}</strong></div>
              <div class="route-compare-row"><span>平均速度</span><strong>${avgSpeedText}</strong></div>
            </article>
          `;
        })
        .join('')
    : `
        <article class="route-compare-card is-empty">
          <div class="route-compare-head">
            <span class="route-compare-chip" style="--route-color: ${ROUTE_META.distance.color}"></span>
            <strong>${ROUTE_META.distance.label}</strong>
          </div>
          <div class="route-compare-row"><span>路径长度</span><strong>--</strong></div>
          <div class="route-compare-row"><span>预计耗时</span><strong>--</strong></div>
        </article>
        <article class="route-compare-card is-empty">
          <div class="route-compare-head">
            <span class="route-compare-chip" style="--route-color: ${ROUTE_META.time.color}"></span>
            <strong>${ROUTE_META.time.label}</strong>
          </div>
          <div class="route-compare-row"><span>路径长度</span><strong>--</strong></div>
          <div class="route-compare-row"><span>预计耗时</span><strong>--</strong></div>
        </article>
      `;

  refs.routeSummary.innerHTML = `
    <div class="summary-row"><span>起点</span><strong>${state.routeStart ? formatPoint(state.routeStart) : '未设置'}</strong></div>
    <div class="summary-row"><span>终点</span><strong>${state.routeEnd ? formatPoint(state.routeEnd) : '未设置'}</strong></div>
    <div class="route-compare-grid">
      ${compareCards}
    </div>
  `;
}

function shouldLoadPoiForCurrentView() {
  return (map.getView().getZoom() ?? 0) >= POI_MIN_LOAD_ZOOM;
}

function getCurrentPoiExtent4326() {
  const size = map.getSize();
  if (!size) {
    return null;
  }

  const extent = transformExtent(map.getView().calculateExtent(size), 'EPSG:3857', 'EPSG:4326');
  return [
    Math.max(-180, extent[0]),
    Math.max(-90, extent[1]),
    Math.min(180, extent[2]),
    Math.min(90, extent[3])
  ];
}

function getCurrentPoiRequestKey() {
  const extent4326 = getCurrentPoiExtent4326();
  const zoom = map.getView().getZoom() ?? 0;

  if (!extent4326) {
    return `empty:${zoom.toFixed(1)}`;
  }

  return [zoom.toFixed(1), ...extent4326.map((value) => value.toFixed(3))].join(':');
}

function applyPoiFeatureCollection(nextPoiFeatureCollection) {
  poiFeatureCollection = nextPoiFeatureCollection;
  poiFeatures = geoJsonFormat.readFeatures(poiFeatureCollection, {
    dataProjection: 'EPSG:4326',
    featureProjection: 'EPSG:3857'
  });
  LAYER_COUNTS = getLayerCounts(roadFeatureCollection, poiFeatureCollection);

  syncPoiLayerSources();
  renderLayerCounts();
}

function renderLayerCounts() {
  const layerUnitMap = {
    highway: '条',
    national: '条',
    provincial: '条',
    county: '条',
    bus: '处',
    school: '处',
    hospital: '处'
  };

  Object.entries(LAYER_COUNTS).forEach(([key, value]) => {
    const countElement = document
      .querySelector(`[data-layer="${key}"]`)
      ?.closest('.layer-row')
      ?.querySelector('.layer-count');

    if (countElement) {
      if (Object.hasOwn(POI_META, key)) {
        if (!shouldLoadPoiForCurrentView()) {
          countElement.textContent = '\u653e\u5927\u770b';
          return;
        }

        if (poiRuntime.isLoading) {
          countElement.textContent = '\u52a0\u8f7d\u4e2d';
          return;
        }
      }

      countElement.textContent = `${value}${layerUnitMap[key] || ''}`;
    }
  });
}

function syncRoadLayerSources() {
  Object.entries(ROAD_TYPE_META).forEach(([roadType]) => {
    const source = roadLayers[roadType]?.getSource();
    if (!source) {
      return;
    }

    source.clear();
    source.addFeatures(roadFeatures.filter((feature) => feature.get('roadType') === roadType));
  });
}

function syncPoiLayerSources() {
  Object.entries(POI_META).forEach(([category]) => {
    const source = poiSources[category];
    if (!source) {
      return;
    }

    source.clear();
    source.addFeatures(poiFeatures.filter((feature) => feature.get('category') === category));
  });
}

async function hydrateMapData() {
  const [nextRoadFeatureCollection, nextPoiFeatureCollection] = await Promise.all([
    loadRoadFeatureCollection(),
    loadPoiFeatureCollection()
  ]);

  roadFeatureCollection = nextRoadFeatureCollection;
  roadFeatures = geoJsonFormat.readFeatures(roadFeatureCollection, {
    dataProjection: 'EPSG:4326',
    featureProjection: 'EPSG:3857'
  });
  
  // 保存所有POI数据，用于搜索
  allPoiFeatureCollection = nextPoiFeatureCollection;
  
  LAYER_COUNTS = getLayerCounts(roadFeatureCollection, allPoiFeatureCollection);

  syncRoadLayerSources();
  renderLayerCounts();
  clearSelection();
  refreshPoiDataForCurrentView(true);
}

function schedulePoiRefresh(force = false) {
  if (poiRuntime.debounceTimer) {
    window.clearTimeout(poiRuntime.debounceTimer);
  }

  poiRuntime.debounceTimer = window.setTimeout(() => {
    refreshPoiDataForCurrentView(force);
  }, POI_REQUEST_DEBOUNCE_MS);
}

async function refreshPoiDataForCurrentView(force = false) {
  if (!shouldLoadPoiForCurrentView()) {
    poiRuntime.isLoading = false;
    poiRuntime.latestRequestKey = '';
    applyPoiFeatureCollection(createEmptyFeatureCollection());
    return;
  }

  const extent4326 = getCurrentPoiExtent4326();
  if (!extent4326) {
    return;
  }

  const requestKey = getCurrentPoiRequestKey();
  if (!force && requestKey === poiRuntime.latestRequestKey) {
    return;
  }

  poiRuntime.isLoading = true;
  poiRuntime.latestRequestKey = requestKey;
  renderLayerCounts();

  const requestId = ++poiRuntime.latestRequestId;
  const nextPoiFeatureCollection = await loadPoiFeatureCollection(extent4326);

  if (requestId !== poiRuntime.latestRequestId) {
    return;
  }

  poiRuntime.isLoading = false;
  applyPoiFeatureCollection(nextPoiFeatureCollection);
}

function updateZoomStatus() {
  renderLayerCounts();
}

function createRoadStyle(feature, meta) {
  return new Style({
    stroke: new Stroke({
      color: meta.color,
      width: meta.width
    }),
    zIndex: meta.width
  });
}

function createPoiStyle(meta) {
  // 确保clusterStyleCache是一个有效的Map对象
  let clusterStyleCache;
  try {
    clusterStyleCache = new Map();
  } catch (e) {
    console.error('Failed to create Map for clusterStyleCache:', e);
    clusterStyleCache = {};
  }

  return (feature) => {
    try {
      const clusterMembers = feature.get('features');
      const isCluster = Array.isArray(clusterMembers);
      const size = isCluster ? clusterMembers.length : 1;

      if (size > 1) {
        // 检查clusterStyleCache是否有has方法
        if (typeof clusterStyleCache.has === 'function') {
          if (!clusterStyleCache.has(size)) {
            clusterStyleCache.set(
              size,
              new Style({
                image: new CircleStyle({
                  radius: Math.min(22, 11 + Math.log2(size) * 3),
                  fill: new Fill({
                    color: meta.color
                  }),
                  stroke: new Stroke({
                    color: '#ffffff',
                    width: 3
                  })
                }),
                text: new Text({
                  text: String(size),
                  fill: new Fill({
                    color: '#ffffff'
                  }),
                  font: 'bold 12px "Microsoft YaHei UI"'
                }),
                zIndex: 31
              })
            );
          }
          return clusterStyleCache.get(size);
        } else {
          // 如果clusterStyleCache不是Map，使用普通对象
          if (!clusterStyleCache[size]) {
            clusterStyleCache[size] = new Style({
              image: new CircleStyle({
                radius: Math.min(22, 11 + Math.log2(size) * 3),
                fill: new Fill({
                  color: meta.color
                }),
                stroke: new Stroke({
                  color: '#ffffff',
                  width: 3
                })
              }),
              text: new Text({
                text: String(size),
                fill: new Fill({
                  color: '#ffffff'
                }),
                font: 'bold 12px "Microsoft YaHei UI"'
              }),
              zIndex: 31
            });
          }
          return clusterStyleCache[size];
        }
      }

      const targetFeature = isCluster ? clusterMembers[0] : feature;
      const showLabel = (map.getView().getZoom() ?? 0) >= POI_LABEL_MIN_ZOOM;
      const styles = [
        new Style({
          image: new CircleStyle({
            radius: 9,
            fill: new Fill({
              color: meta.color
            }),
            stroke: new Stroke({
              color: '#ffffff',
              width: 3
            })
          }),
          text: new Text({
            text: meta.text,
            fill: new Fill({
              color: '#ffffff'
            }),
            font: 'bold 11px "Microsoft YaHei UI"'
          }),
          zIndex: 30
        })
      ];

      if (showLabel) {
        styles.push(
          new Style({
            text: new Text({
              text: targetFeature.get('name'),
              offsetY: 18,
              font: '12px "Microsoft YaHei UI"',
              fill: new Fill({
                color: '#10233a'
              }),
              backgroundFill: new Fill({
                color: 'rgba(255,255,255,0.9)'
              }),
              backgroundStroke: new Stroke({
                color: 'rgba(197, 211, 227, 0.9)',
                width: 1
              }),
              padding: [2, 6, 2, 6]
            }),
            zIndex: 29
          })
        );
      }

      return styles;
    } catch (e) {
      console.error('Error in createPoiStyle:', e);
      // 返回一个默认样式，避免地图渲染失败
      return new Style({
        image: new CircleStyle({
          radius: 9,
          fill: new Fill({
            color: meta.color || '#000000'
          }),
          stroke: new Stroke({
            color: '#ffffff',
            width: 3
          })
        })
      });
    }
  };
}

function createMarkerStyle(feature) {
  const isStart = feature.get('role') === 'start';

  return new Style({
    image: new CircleStyle({
      radius: 11,
      fill: new Fill({
        color: isStart ? '#0f766e' : '#b91c1c'
      }),
      stroke: new Stroke({
        color: '#ffffff',
        width: 3
      })
    }),
    text: new Text({
      text: isStart ? '起' : '终',
      fill: new Fill({
        color: '#ffffff'
      }),
      font: 'bold 12px "Microsoft YaHei UI"'
    })
  });
}

function createSelectionStyle(feature) {
  if (feature.getGeometry().getType() === 'Point') {
    return new Style({
      image: new CircleStyle({
        radius: 15,
        fill: new Fill({
          color: 'rgba(255, 255, 255, 0.24)'
        }),
        stroke: new Stroke({
          color: '#f8fafc',
          width: 3
        })
      })
    });
  }

  return new Style({
    stroke: new Stroke({
      color: '#f8fafc',
      width: 10,
      lineDash: [10, 8]
    })
  });
}

function formatDistance(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${value.toFixed(0)} m`;
}

function formatArea(value) {
  return value >= 1000000 ? `${(value / 1000000).toFixed(2)} km²` : `${value.toFixed(0)} m²`;
}

function formatDuration(value) {
  return `${value.toFixed(1)} 分钟`;
}

function formatPoint([lon, lat]) {
  return `${lon.toFixed(4)}, ${lat.toFixed(4)}`;
}
