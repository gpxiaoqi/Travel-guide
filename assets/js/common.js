const AMAP_KEY = '__AMAP_KEY__';
let amapRequestQueue = Promise.resolve();

function requestAmapService(path, params) {
  const request = () => new Promise((resolve, reject) => {
    const callbackName = `amapCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const query = new URLSearchParams({ ...params, key: AMAP_KEY, output: 'JSON', callback: callbackName });
    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = payload => {
      cleanup();
      if (payload?.status === '1') resolve(payload);
      else reject(new Error(payload?.info || '高德服务请求失败'));
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('高德服务请求失败'));
    };
    script.src = `https://restapi.amap.com${path}?${query}`;
    document.head.appendChild(script);
  });
  const queuedRequest = amapRequestQueue
    .then(() => new Promise(resolve => setTimeout(resolve, 350)))
    .then(request);
  amapRequestQueue = queuedRequest.catch(() => {});
  return queuedRequest;
}

function toAmapPosition(coords) {
  return [Number(coords[1]), Number(coords[0])];
}

async function convertLocationsToAmap(locations) {
  const points = locations.map(loc => toAmapPosition(loc.coords));
  const payload = await requestAmapService('/v3/assistant/coordinate/convert', {
    locations: points.map(point => point.join(',')).join('|'),
    coordsys: 'gps'
  });
  const converted = payload.locations.split(';').map(point => point.split(',').map(Number));
  if (converted.length !== locations.length) throw new Error('高德坐标转换结果不完整');
  return converted;
}

function thinRoutePath(path, maxPoints = 35) {
  if (path.length <= maxPoints) return path;
  const step = (path.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => path[Math.round(index * step)]);
}

function renderAmapStaticMap(container, locations, plannedRoutes) {
  const routeColors = { blue: '#1677ff', red: '#e85d3f', green: '#16856f', orange: '#a87500' };
  const markerPoints = locations.map(loc => toAmapPosition(loc.coords).join(',')).join(';');
  const markers = `mid,0x1677ff,游:${markerPoints}`;
  const paths = plannedRoutes.map(route => {
    const routeColor = routeColors[route.color] || route.color || '#1677ff';
    const color = `0x${routeColor.replace('#', '')}`;
    const points = thinRoutePath(route.path).map(point => point.join(',')).join(';');
    return `6,${color},0.85,,0:${points}`;
  }).join('|');
  const query = new URLSearchParams({
    key: AMAP_KEY,
    size: '1024*430',
    scale: '1',
    traffic: '1',
    markers,
    paths
  });
  const first = plannedRoutes[0]?.path[0] || toAmapPosition(locations[0].coords);
  const lastRoute = plannedRoutes.at(-1);
  const last = lastRoute?.path.at(-1) || toAmapPosition(locations.at(-1).coords);
  const navigationUrl = `https://uri.amap.com/navigation?from=${first.join(',')},起点&to=${last.join(',')},终点&mode=car&policy=1&src=dapeng-guide&callnative=0`;

  container.innerHTML = `<img class="amap-static-map" src="https://restapi.amap.com/v3/staticmap?${query}" alt="高德地图路线规划图">
    <a class="amap-open-link" href="${navigationUrl}" target="_blank" rel="noopener"><i class="fas fa-location-arrow"></i> 在高德地图打开</a>`;
}

// Calculate each itinerary segment on AMap roads, then render it on an AMap base map.
async function initMap(containerId, locations, routesData = []) {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const convertedPositions = await convertLocationsToAmap(locations);
    const positionBySource = new Map(locations.map((loc, index) => [loc.coords.join(','), convertedPositions[index]]));
    const routeResults = await Promise.allSettled(routesData.map(route => new Promise((resolve, reject) => {
      if (!Array.isArray(route.path) || route.path.length < 2) {
        resolve(null);
        return;
      }

      const positions = route.path.map(coords => positionBySource.get(coords.join(',')) || toAmapPosition(coords));
      const params = {
        origin: positions[0].join(','),
        destination: positions.at(-1).join(','),
        strategy: '0',
        extensions: 'base'
      };
      if (positions.length > 2) params.waypoints = positions.slice(1, -1).map(item => item.join(',')).join(';');

      requestAmapService('/v3/direction/driving', params).then(result => {
        const plan = result.route?.paths?.[0];
        if (!plan) throw new Error('高德驾车路线规划失败');
        const path = plan.steps.flatMap(step => (step.polyline || '').split(';').filter(Boolean).map(point => point.split(',').map(Number)));
        const roads = [...new Set(plan.steps.map(step => step.road).filter(Boolean))].slice(0, 4);
        resolve({
          path,
          color: route.color,
          summary: {
            name: route.name || '高德推荐路线',
            distance: plan.distance,
            duration: plan.time || plan.duration || 0,
            tolls: plan.tolls,
            roads: roads.join(' → ') || '高德实时推荐道路'
          }
        });
      }).catch(reject);
    })));

    const completedRoutes = routeResults.filter(result => result.status === 'fulfilled' && result.value).map(result => result.value);
    const routeSummaries = completedRoutes.map(route => route.summary);
    if (!completedRoutes.length) throw new Error('高德路线规划暂不可用');
    const amapLocations = locations.map((loc, index) => ({ ...loc, coords: [convertedPositions[index][1], convertedPositions[index][0]] }));
    renderAmapStaticMap(container, amapLocations, completedRoutes);
    container.dataset.mapProvider = 'amap';
    return { routes: routeSummaries };
  } catch (error) {
    console.error(error);
    container.innerHTML = '<div class="map-error"><i class="fas fa-map-location-dot"></i><strong>高德地图暂时无法加载</strong><span>请检查网络后刷新页面</span></div>';
  }
}

// Shared static route catalog used by the home decision tools and every detail page.
(function () {
  const isRoutePage = /\/routes\/[^/]+\.html$/i.test(window.location.pathname);
  const isNestedPage = /\/(?:routes|categories)\/[^/]+\.html$/i.test(window.location.pathname);
  const pagePrefix = isNestedPage ? '../' : '';
  const catalogUrl = `${pagePrefix}assets/data/routes.json`;
  let catalogPromise;

  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = fetch(catalogUrl, { cache: 'no-cache' }).then(response => {
        if (!response.ok) throw new Error(`路线数据加载失败 (${response.status})`);
        return response.json();
      }).then(data => {
        if (!Array.isArray(data.routes) || data.routes.length === 0) {
          throw new Error('路线数据格式不完整');
        }
        return data;
      });
    }
    return catalogPromise;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
    })[character]);
  }

  function formatVerifiedDate(value) {
    const [year, month, day] = String(value).split('-');
    return `${year}年${Number(month)}月${Number(day)}日`;
  }

  function navigationUrl(stop) {
    const params = new URLSearchParams({
      to: `${stop.lng},${stop.lat},${stop.name}`,
      mode: 'car',
      policy: '1',
      src: 'dapeng-guide',
      callnative: '0'
    });
    return `https://uri.amap.com/navigation?${params}`;
  }

  function routeTemplates(route) {
    return Array.isArray(route.itineraryTemplates) ? route.itineraryTemplates : [];
  }

  function routeDurationLabel(route) {
    const templates = routeTemplates(route);
    return templates.length ? templates.map(template => template.label).join(' / ') : route.durationLabel;
  }

  function routeHref(route) {
    return `${pagePrefix}${route.href}`;
  }

  function routeImageUrl(image) {
    return /^(?:https?:)?\/\//i.test(image) ? image : `${pagePrefix}${image}`;
  }

  function routeCardMarkup(route, recommended = false) {
    const tags = [...route.bestFor.slice(0, 2), ...route.themes.slice(0, 1)];
    return `<article class="route-card${recommended ? ' is-recommended' : ''}" data-route-id="${escapeHtml(route.id)}">
      <div class="route-img" role="img" aria-label="${escapeHtml(route.imageAlt)}" style="background-image: url('${escapeHtml(routeImageUrl(route.image))}');">
        ${recommended ? '<span class="route-card__recommend-badge"><i class="fas fa-star"></i> 当前推荐</span>' : ''}
      </div>
      <div class="route-content">
        <div class="route-card__topline"><span>${escapeHtml(route.departure)}</span><span>${escapeHtml(route.intensity.level)}强度</span></div>
        <h3 class="route-title">${escapeHtml(route.title)}</h3>
        <div class="route-facts" aria-label="路线关键信息">
          <span><i class="fas fa-clock"></i><strong>${escapeHtml(routeDurationLabel(route))}</strong></span>
          <span><i class="fas fa-car"></i><strong>${escapeHtml(route.drive.label)}</strong></span>
          <span><i class="fas fa-wallet"></i><strong>${escapeHtml(route.budget.label)}</strong></span>
        </div>
        <p class="route-desc">${escapeHtml(route.summary)}</p>
        <div class="route-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="route-card__actions">
          <a href="${escapeHtml(routeHref(route))}" class="btn">查看行程 <i class="fas fa-arrow-right"></i></a>
          <button class="route-compare-toggle" type="button" data-compare-route="${escapeHtml(route.id)}" aria-pressed="false">
            <i class="fas fa-code-compare"></i><span>加入对比</span>
          </button>
        </div>
      </div>
    </article>`;
  }

  function initHomeCatalog(data) {
    const grid = document.getElementById('route-catalog');
    const form = document.getElementById('route-filters');
    if (!grid || !form) return;

    const requestedCategory = grid.dataset.category;
    const routes = data.routes.filter(route => !requestedCategory || route.category === requestedCategory).map(route => ({
      ...route,
      itineraryTemplates: data.itineraryTemplates?.[route.id] || []
    }));
    form.hidden = routes.length === 0;
    const fields = {
      days: document.getElementById('filter-days'),
      budget: document.getElementById('filter-budget'),
      drive: document.getElementById('filter-drive')
    };
    const summary = document.getElementById('catalog-summary');
    const recommendation = document.getElementById('route-recommendation');
    const compareIds = new Set();
    let recommendedId = null;

    const matchesFilters = route => {
      const days = fields.days.value;
      const budget = fields.budget.value;
      const drive = fields.drive.value;
      const availableDays = routeTemplates(route).map(template => template.days);
      const daysMatch = days === 'all' || (days === '4'
        ? (availableDays.length ? availableDays.some(value => value >= 4) : route.days >= 4)
        : (availableDays.length ? availableDays.includes(Number(days)) : route.days === Number(days)));
      const budgetMatch = budget === 'all' || route.budget.perPersonMin <= Number(budget);
      const driveMatch = drive === 'all' || route.drive.oneWayHours <= Number(drive);
      return daysMatch && budgetMatch && driveMatch;
    };

    const recommendationScore = route => {
      let score = 0;
      const days = fields.days.value;
      const budget = fields.budget.value;
      const drive = fields.drive.value;
      if (days !== 'all') {
        const desiredDays = Number(days);
        const availableDays = routeTemplates(route).map(template => template.days);
        const dayDifference = availableDays.length
          ? Math.min(...availableDays.map(value => Math.abs(value - desiredDays)))
          : Math.abs(route.days - desiredDays);
        const hasLongTrip = availableDays.length ? availableDays.some(value => value >= 4) : route.days >= 4;
        score += days === '4' ? (hasLongTrip ? 7 : -dayDifference * 3) : 7 - dayDifference * 4;
      }
      if (budget !== 'all') {
        const cap = Number(budget);
        const midpoint = (route.budget.perPersonMin + route.budget.perPersonMax) / 2;
        score += midpoint <= cap ? 5 : route.budget.perPersonMin <= cap ? 2 : -6;
      }
      if (drive !== 'all') {
        const cap = Number(drive);
        score += route.drive.oneWayHours <= cap ? 4 : -Math.ceil(route.drive.oneWayHours - cap) * 3;
      }
      score += Math.max(0, 4 - route.intensity.score) * 0.25;
      return score;
    };

    const compareTray = document.createElement('div');
    compareTray.className = 'compare-tray';
    compareTray.hidden = true;
    document.body.append(compareTray);

    const dialog = document.createElement('dialog');
    dialog.className = 'compare-dialog';
    dialog.setAttribute('aria-labelledby', 'compare-dialog-title');
    document.body.append(dialog);

    const syncCompareButtons = () => {
      grid.querySelectorAll('[data-compare-route]').forEach(button => {
        const selected = compareIds.has(button.dataset.compareRoute);
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', String(selected));
        button.querySelector('span').textContent = selected ? '已加入' : '加入对比';
        button.disabled = !selected && compareIds.size >= 3;
      });
    };

    const updateTray = () => {
      const selected = routes.filter(route => compareIds.has(route.id));
      compareTray.hidden = selected.length === 0;
      compareTray.innerHTML = `<div class="compare-tray__content">
        <div><strong>路线对比</strong><span>${selected.length}/3</span></div>
        <div class="compare-tray__routes">${selected.map(route => `<span>${escapeHtml(route.shortTitle)}</span>`).join('')}</div>
        <button type="button" class="btn" data-open-comparison ${selected.length < 2 ? 'disabled' : ''}><i class="fas fa-code-compare"></i> 开始对比</button>
        <button type="button" class="compare-tray__clear" data-clear-comparison aria-label="清空对比"><i class="fas fa-trash-can"></i></button>
      </div>`;
      syncCompareButtons();
    };

    const comparisonMarkup = selected => `<div class="compare-dialog__header">
        <div><span class="section-eyebrow">并排看差异</span><h2 id="compare-dialog-title">路线对比</h2></div>
        <button type="button" class="compare-dialog__close" data-close-comparison aria-label="关闭路线对比"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="compare-table-wrap">
        <table class="compare-table">
          <thead><tr><th scope="col">对比项</th>${selected.map(route => `<th scope="col">${escapeHtml(route.shortTitle)}</th>`).join('')}</tr></thead>
          <tbody>
            <tr><th scope="row">行程</th>${selected.map(route => `<td>${escapeHtml(routeDurationLabel(route))}</td>`).join('')}</tr>
            <tr><th scope="row">预算</th>${selected.map(route => `<td>${escapeHtml(route.budget.label)}</td>`).join('')}</tr>
            <tr><th scope="row">车程</th>${selected.map(route => `<td>${escapeHtml(route.drive.label)}<small>往返约${route.drive.totalKm}公里</small></td>`).join('')}</tr>
            <tr><th scope="row">强度</th>${selected.map(route => `<td><strong>${escapeHtml(route.intensity.level)}</strong><small>${escapeHtml(route.intensity.description)}</small></td>`).join('')}</tr>
            <tr><th scope="row">适合</th>${selected.map(route => `<td>${route.bestFor.map(item => escapeHtml(item)).join('、')}</td>`).join('')}</tr>
            <tr><th scope="row">操作</th>${selected.map(route => `<td><a class="btn" href="${escapeHtml(routeHref(route))}">查看行程</a></td>`).join('')}</tr>
          </tbody>
        </table>
      </div>`;

    const render = () => {
      const visible = routes.filter(matchesFilters);
      grid.innerHTML = visible.length
        ? visible.map(route => routeCardMarkup(route, route.id === recommendedId)).join('')
        : `<div class="route-empty"><i class="fas fa-route"></i><h3>${escapeHtml(grid.dataset.emptyTitle || '暂时没有完全符合的路线')}</h3><p>${escapeHtml(grid.dataset.emptyCopy || '放宽一个条件，或者点击“条件推荐”查看最接近的选择。')}</p></div>`;
      summary.innerHTML = `共找到 <strong>${visible.length}</strong> 条路线`;
      syncCompareButtons();
      document.dispatchEvent(new CustomEvent('route-catalog-rendered'));
    };

    Object.values(fields).forEach(field => field.addEventListener('change', () => {
      recommendedId = null;
      recommendation.hidden = true;
      render();
    }));

    form.addEventListener('submit', event => {
      event.preventDefault();
      const hasConditions = Object.values(fields).some(field => field.value !== 'all');
      if (!hasConditions) {
        recommendation.hidden = false;
        recommendation.innerHTML = '<i class="fas fa-circle-info"></i><div><strong>先选一个条件</strong><p>设置可玩天数、预算或车程后，推荐结果会更有意义。</p></div>';
        return;
      }
      const ranked = [...routes].sort((a, b) => recommendationScore(b) - recommendationScore(a));
      const best = ranked[0];
      recommendedId = best.id;
      recommendation.hidden = false;
      recommendation.innerHTML = `<i class="fas fa-wand-magic-sparkles"></i><div><span>条件匹配度最高</span><strong>${escapeHtml(best.title)}</strong><p>${escapeHtml(routeDurationLabel(best))} · ${escapeHtml(best.budget.label)} · ${escapeHtml(best.drive.label)}，${escapeHtml(best.intensity.level)}强度。</p></div><a class="btn" href="${escapeHtml(routeHref(best))}">查看推荐</a>`;
      render();
      recommendation.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    document.getElementById('reset-routes').addEventListener('click', () => {
      form.reset();
      recommendedId = null;
      recommendation.hidden = true;
      render();
    });

    grid.addEventListener('click', event => {
      const button = event.target.closest('[data-compare-route]');
      if (!button) return;
      const id = button.dataset.compareRoute;
      if (compareIds.has(id)) compareIds.delete(id);
      else if (compareIds.size < 3) compareIds.add(id);
      updateTray();
    });

    compareTray.addEventListener('click', event => {
      if (event.target.closest('[data-clear-comparison]')) {
        compareIds.clear();
        updateTray();
      }
      if (event.target.closest('[data-open-comparison]')) {
        const selected = routes.filter(route => compareIds.has(route.id));
        dialog.innerHTML = comparisonMarkup(selected);
        dialog.showModal();
      }
    });
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-close-comparison]')) dialog.close();
      if (event.target === dialog) dialog.close();
    });

    render();
    updateTray();
  }

  function resolveNavigation(route, plan) {
    if (!plan?.navigation?.length) return route.navigation;
    return plan.navigation.map(item => {
      const stop = route.navigation.find(candidate => candidate.name === item.name);
      return stop ? { ...stop, day: item.day || stop.day } : null;
    }).filter(Boolean);
  }

  function detailDecisionMarkup(route, budgetBasis, plan, researchSources = []) {
    const activeBudget = plan?.budget || route.budget;
    const activeIntensity = plan?.intensity || route.intensity;
    const activeDuration = plan?.label || route.durationLabel;
    const activeNavigation = resolveNavigation(route, plan);
    const bookingMarkup = route.bookings.length
      ? route.bookings.map(item => `<a class="booking-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.channel)}</small></span><i class="fas fa-arrow-up-right-from-square"></i></a>`).join('')
      : '<div class="booking-empty"><i class="fas fa-circle-check"></i><span><strong>本线路暂无统一预约项目</strong><small>收费体验请在出发前通过景区官方渠道确认。</small></span></div>';
    const sourceMarkup = plan?.sourceRefs?.map(sourceId => researchSources.find(source => source.id === sourceId)).filter(Boolean)
      .map(source => `<a class="research-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-building-columns"></i><span><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(source.publisher)}</small></span><i class="fas fa-arrow-up-right-from-square"></i></a>`).join('') || '';
    const transportFact = Array.isArray(route.transportModes) && route.transportModes.length
      ? `<div><i class="fas fa-route"></i><span>交通方式<strong>${route.transportModes.map(mode => escapeHtml(mode.label)).join(' / ')}</strong></span></div>`
      : `<div><i class="fas fa-road"></i><span>驾驶距离<strong>往返约${route.drive.totalKm}公里</strong></span></div>`;
    return `<section class="trip-decision-section" id="trip-decision">
      <div class="trip-decision__heading">
        <div><span class="section-eyebrow">出发前先确认</span><h2><i class="fas fa-clipboard-check"></i> 行程决策信息</h2></div>
        <div class="verification-chip"><i class="fas fa-shield-check"></i><span>最近核验<strong>${formatVerifiedDate(route.verifiedAt)}</strong></span></div>
      </div>
      <div class="decision-facts">
        <div><i class="fas fa-calendar-day"></i><span>行程天数<strong>${escapeHtml(activeDuration)}</strong></span></div>
        <div><i class="fas fa-wallet"></i><span>预算参考<strong>${escapeHtml(activeBudget.label)}</strong></span></div>
        <div><i class="fas fa-person-hiking"></i><span>行程强度<strong>${escapeHtml(activeIntensity.level)}</strong></span></div>
        ${transportFact}
      </div>
      <div class="decision-layout">
        <article class="decision-panel">
          <div class="decision-panel__title"><i class="fas fa-receipt"></i><div><h3>预算拆分</h3><p>${escapeHtml(budgetBasis)}</p></div></div>
          <dl class="budget-list">${activeBudget.breakdown.map(item => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join('')}</dl>
          <p class="decision-note"><i class="fas fa-gauge-high"></i><strong>${escapeHtml(activeIntensity.level)}：</strong>${escapeHtml(activeIntensity.description)}</p>
        </article>
        <article class="decision-panel">
          <div class="decision-panel__title"><i class="fas fa-ticket"></i><div><h3>预约入口</h3><p>仅保留官方或政府渠道</p></div></div>
          <div class="booking-list">${bookingMarkup}</div>
          ${sourceMarkup ? `<div class="research-list"><span>攻略调整依据</span>${sourceMarkup}</div>` : ''}
          <p class="decision-note"><i class="fas fa-circle-info"></i>${escapeHtml(route.verificationNote)}</p>
        </article>
      </div>
      <article class="stop-navigation">
        <div class="decision-panel__title"><i class="fas fa-location-arrow"></i><div><h3>逐站导航</h3><p>按建议顺序打开高德地图，实时路线以导航结果为准</p></div></div>
        <ol>${activeNavigation.map((stop, index) => `<li><span class="stop-number">${index + 1}</span><div><small>${escapeHtml(stop.day)}</small><strong>${escapeHtml(stop.name)}</strong><p>${escapeHtml(stop.note)}</p></div><a href="${navigationUrl(stop)}" target="_blank" rel="noopener noreferrer" aria-label="导航到${escapeHtml(stop.name)}"><i class="fas fa-location-arrow"></i><span>导航</span></a></li>`).join('')}</ol>
      </article>
    </section>`;
  }

  function durationSelectorMarkup(templates, selectedId) {
    return `<section class="duration-planner" aria-labelledby="duration-planner-title">
      <div class="duration-planner__copy"><span class="section-eyebrow">按时间生成攻略</span><h2 id="duration-planner-title"><i class="fas fa-calendar-days"></i> 选择旅行时间</h2><p>两套行程会同步调整每日安排、预算、强度和导航顺序。</p></div>
      <div class="duration-segments" role="group" aria-label="旅行时间">${templates.map(template => `<button type="button" data-duration-template="${escapeHtml(template.id)}" class="duration-segment${template.id === selectedId ? ' is-active' : ''}" aria-pressed="${template.id === selectedId}"><strong>${escapeHtml(template.label)}</strong><span>${escapeHtml(template.summary)}</span></button>`).join('')}</div>
    </section>`;
  }

  function planOverviewMarkup(plan) {
    return `<h2><i class="fas fa-list-ul"></i> 行程概览</h2><div class="grid-overview">${plan.dayPlans.map(day => `<article class="day-card"><div class="day-header">Day ${day.day}</div><div class="day-title">${escapeHtml(day.title)}</div><div class="day-icons"><i class="fas fa-route" aria-hidden="true"></i><i class="fas fa-camera" aria-hidden="true"></i><i class="fas fa-utensils" aria-hidden="true"></i></div><p>${escapeHtml(day.summary)}</p></article>`).join('')}</div>`;
  }

  function planItineraryMarkup(plan) {
    return `<h2><i class="fas fa-clock"></i> 详细时间表</h2>${plan.dayPlans.map(day => `<div class="day-detail"><h3 class="day-heading">Day ${day.day}: ${escapeHtml(day.title)}</h3><div class="timeline">${day.items.map(item => `<div class="timeline-item"><div class="time">${escapeHtml(item.time)}</div><div class="content"><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.description)}</p>${item.tag ? `<span class="tag${/预约|必/.test(item.tag) ? ' highlight' : ''}">${escapeHtml(item.tag)}</span>` : ''}</div></div>`).join('')}</div></div>`).join('')}`;
  }

  function renderSelectedPlan(main, route, plan, data) {
    const selector = main.querySelector('.duration-planner');
    if (selector) selector.outerHTML = durationSelectorMarkup(route.itineraryTemplates, plan.id);

    const overview = main.querySelector('.overview-section');
    const itinerary = main.querySelector('.itinerary-section');
    if (overview) overview.innerHTML = planOverviewMarkup(plan);
    if (itinerary) itinerary.innerHTML = planItineraryMarkup(plan);

    main.querySelector('.trip-decision-section')?.remove();
    const currentSelector = main.querySelector('.duration-planner');
    currentSelector.insertAdjacentHTML('afterend', detailDecisionMarkup(route, data.budgetBasis, plan, data.researchSources));

    const heroTitle = document.querySelector('.hero h1');
    const heroDuration = document.querySelector('.hero .meta-info span:first-child');
    if (heroTitle) heroTitle.textContent = plan.title;
    if (heroDuration) heroDuration.innerHTML = `<i class="fas fa-calendar-alt"></i> ${escapeHtml(plan.label)} · 可随时切换`;
    document.title = `${plan.title}攻略`;
    document.dispatchEvent(new CustomEvent('route-detail-rendered', { detail: { routeId: route.id, templateId: plan.id } }));
  }

  function initDetailDecision(data) {
    if (!isRoutePage) return;
    const match = window.location.pathname.match(/\/routes\/([^/.]+)\.html$/i);
    const route = data.routes.find(item => item.id === match?.[1].toLowerCase());
    const main = document.querySelector('main.container');
    if (!route || !main || main.querySelector('.trip-decision-section')) return;
    route.itineraryTemplates = data.itineraryTemplates?.[route.id] || [];
    if (!route.itineraryTemplates.length) {
      const weather = main.querySelector('.weekend-weather');
      if (weather) weather.insertAdjacentHTML('afterend', detailDecisionMarkup(route, data.budgetBasis, null, data.researchSources));
      else main.insertAdjacentHTML('afterbegin', detailDecisionMarkup(route, data.budgetBasis, null, data.researchSources));
      document.dispatchEvent(new CustomEvent('route-detail-rendered'));
      return;
    }

    const queryTemplate = new URLSearchParams(window.location.search).get('duration');
    const initialPlan = route.itineraryTemplates.find(template => template.id === queryTemplate) || route.itineraryTemplates[0];
    const overview = main.querySelector('.overview-section');
    overview.insertAdjacentHTML('beforebegin', durationSelectorMarkup(route.itineraryTemplates, initialPlan.id));
    renderSelectedPlan(main, route, initialPlan, data);

    main.addEventListener('click', event => {
      const button = event.target.closest('[data-duration-template]');
      if (!button) return;
      const plan = route.itineraryTemplates.find(template => template.id === button.dataset.durationTemplate);
      if (!plan) return;
      const url = new URL(window.location.href);
      url.searchParams.set('duration', plan.id);
      window.history.replaceState({}, '', url);
      renderSelectedPlan(main, route, plan, data);
      main.querySelector('.duration-planner').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function initRouteDataFeatures() {
    loadCatalog().then(data => {
      initHomeCatalog(data);
      initDetailDecision(data);
    }).catch(error => {
      console.error(error);
      const summary = document.getElementById('catalog-summary');
      if (summary) summary.textContent = '路线数据暂时无法读取，请刷新页面重试。';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRouteDataFeatures);
  } else {
    initRouteDataFeatures();
  }
})();

// Weekend weather and weather-aware itinerary rendering.
(function () {
  let requestedPlanMode = null;
  const DESTINATIONS = {
    dapeng: {
      name: '大鹏半岛', weatherCity: '440300', weatherLabel: '深圳',
      sunny: {
        title: '晴天版 · 山海追光线', summary: '把海岸、栈道和日落放在光线最好的时段，户外体验优先。',
        stops: ['上午：大鹏所城慢逛，避开正午强光', '下午：杨梅坑骑行或海岸徒步', '傍晚：天文台栈道看日落，提前预约'],
        tips: '带防晒衣、墨镜和充足饮水；海边紫外线通常比城区更强。'
      },
      rainy: {
        title: '雨天版 · 古城人文线', summary: '减少礁石、栈道和骑行，把行程切换到古城、展馆与慢餐。',
        stops: ['上午：大鹏所城室内展馆与古建', '下午：较场尾选临海咖啡馆看雨', '傍晚：南澳海鲜餐，取消湿滑海岸徒步'],
        tips: '穿防滑鞋并带长柄伞；雷雨或大风时不要进入礁石和未开放海岸。'
      }
    },
    nanao: {
      name: '南澳岛', weatherCity: '440523', weatherLabel: '南澳',
      sunny: {
        title: '晴天版 · 环岛灯塔线', summary: '沿海岸顺光环岛，把青澳湾和风车山留给视野清晰的时段。',
        stops: ['上午：长山尾灯塔与环岛公路', '下午：青澳湾、自然之门与沙滩', '傍晚：海边日落后到后宅镇吃海鲜'],
        tips: '准备防晒与补水；热门观景点停车紧张，尽量早到。'
      },
      rainy: {
        title: '雨天版 · 海岛慢游线', summary: '避开风车山和沙滩涉水，重点体验海岛文化、海鲜和观雨。',
        stops: ['上午：后宅镇市场与海岛文化空间', '下午：选海景餐厅或咖啡馆休息', '傍晚：就近吃海鲜，避免雨夜长距离环岛'],
        tips: '跨海大桥遇强风雨需留意交通提示；不要在浪大时靠近堤岸。'
      }
    },
    guangzhou: {
      name: '广州', weatherCity: '440100', weatherLabel: '广州',
      sunny: {
        title: '晴天版 · 新城与西关漫游', summary: '晴天适合串联城市天际线、历史街区和珠江两岸。',
        stops: ['周六傍晚：花城广场、海心沙与广州塔', '周日上午：陈家祠与永庆坊', '周日下午：沙面岛散步，珠江边收尾'],
        tips: '午后炎热时把早茶和展馆作为休息点，户外步行集中在早晚。'
      },
      rainy: {
        title: '雨天版 · 自驾室内文化线', summary: '自驾串联馆舍、商圈和老字号，把雨中步行压缩到最少。',
        stops: ['周六：广东省博物馆或正佳广场', '周日：陈家祠、粤剧艺术博物馆', '餐饮：早茶加北京路商圈，按雨势短途步行'],
        tips: '优先使用商场或场馆地下停车场；暴雨时取消珠江夜游，并避开易积水路段。'
      }
    },
    zhuhai: {
      name: '珠海', weatherCity: '440400', weatherLabel: '珠海',
      sunny: {
        title: '晴天版 · 滨海自驾线', summary: '沿情侣路展开海岸行程，在日月贝和港珠澳大桥口岸追日落夜景。',
        stops: ['上午：城市阳台与香炉湾沙滩', '下午：情侣路、爱情邮局与日月贝', '傍晚：横琴或口岸看夜景'],
        tips: '海岸停车位有限，核心路段可步行或骑行；做好防晒。'
      },
      rainy: {
        title: '雨天版 · 场馆美食线', summary: '以室内场馆和商圈为主，保留短距离的海景窗口。',
        stops: ['上午：珠海博物馆或规划展览馆', '下午：华发商都、横琴商圈慢逛', '傍晚：选择可看海的室内餐厅'],
        tips: '强对流时远离海堤和空旷海滩；自驾注意积水路段和能见度。'
      }
    },
    yangjiang: {
      name: '阳江', weatherCity: '441700', weatherLabel: '阳江',
      sunny: {
        title: '晴天版 · 海陵岛玩海线', summary: '主打沙滩、海岸公路和日落，把温泉作为晚上放松环节。',
        stops: ['上午：十里银滩或大角湾', '下午：海岸自驾与观景点', '晚上：闸坡海鲜后泡温泉'],
        tips: '只在开放浴场和安全时段下水，留意海浪及救生提示。'
      },
      rainy: {
        title: '雨天版 · 海丝文化温泉线', summary: '取消下海和礁岸活动，用博物馆、美食与温泉组成舒适行程。',
        stops: ['上午：广东海上丝绸之路博物馆', '下午：闸坡渔港美食与室内休息', '晚上：提前入住温泉酒店'],
        tips: '雷雨时禁止下海；温泉区域地面湿滑，驾车返程要避开暴雨高峰。'
      }
    },
    wuyi: {
      name: '清远·佛山·江门', weatherCity: '441800', weatherLabel: '清远',
      sunny: {
        title: '晴天版 · 岭南户外环线', summary: '天气稳定时保留漂流、碉楼村落和古镇步行，早晚错峰游览。',
        stops: ['清远：漂流或北江沿岸活动', '佛山：祖庙、岭南天地街区漫步', '江门：开平碉楼与赤坎古镇外景'],
        tips: '跨城路线需每日复查当地预报；户外项目以景区当天开放通知为准。'
      },
      rainy: {
        title: '雨天版 · 三城文化美食线', summary: '暂停漂流和乡野长距离步行，改为展馆、古建室内空间与地方美食。',
        stops: ['清远：城市展馆与温泉', '佛山：祖庙、陶瓷博物馆与顺德美食', '江门：华侨华人博物馆与骑楼街'],
        tips: '三城天气可能不同，出发前分别确认；暴雨时不要进入山区和河谷。'
      }
    },
    chenzhou: {
      name: '郴州', weatherCity: '431000', weatherLabel: '郴州',
      sunny: {
        title: '晴天版 · 丹霞草原追光线', summary: '把高椅岭、仰天湖和小东江清晨时段放在能见度更好的日期，户外主景优先。',
        stops: ['清晨：按预约进入小东江观雾栈道', '上午：高椅岭早入园，避开正午暴晒', '全天：仰天湖或莽山按山区预报择日'],
        tips: '高椅岭遮阴少，仰天湖和莽山昼夜温差大；防晒、补水和薄外套都要准备。'
      },
      rainy: {
        title: '雨天版 · 城市人文与湖畔慢游', summary: '暂停裸露丹霞、草原和高山栈道，把市区文化、东江镇休整与美食作为替代。',
        stops: ['上午：郴州市博物馆或711时光小镇', '下午：裕后街、室内非遗体验或东江镇休整', '晚上：鱼粉、烧鸡公等本地餐饮'],
        tips: '暴雨、雷电、大风或低能见度时取消高椅岭、仰天湖和莽山户外段；山区道路不要夜驾。'
      }
    },
    'inner-mongolia': {
      name: '内蒙古', weatherCity: '150100', weatherLabel: '呼和浩特',
      sunny: {
        title: '晴稳版 · 草原火山与森林公路线', summary: '把乌兰哈达、辉腾锡勒、响沙湾、阿尔山和呼伦贝尔户外主景放在风力较小、能见度较好的日期。',
        stops: ['中西部：乌兰哈达火山、辉腾锡勒与响沙湾按风力择日', '东部：阿尔山森林公园和莫尔格勒河安排完整白天', '转场：每天出发前分别查询起点、终点和中途旗县预警'],
        tips: '页面天气卡显示呼和浩特近两日预报，只作为中部参考；内蒙古东西跨度大，必须逐站查看天气和道路信息。'
      },
      rainy: {
        title: '风雨版 · 城市馆舍与弹性转场线', summary: '暂停火山高处、沙漠腹地、草原无路区和森林长步道，用城市场馆、休整日和短途转场吸收天气变化。',
        stops: ['呼和浩特、鄂尔多斯、包头：优先文化场馆与城市公共空间', '阿尔山、额尔古纳、根河：大风雨雪时留在城镇，不夜驾追景', '呼伦贝尔：G331、G332遇积雪结冰或管制时立即调整住宿'],
        tips: '雷暴时远离空旷草原和高处，沙尘时减速或就近安全停车；任何天气都不进入未开放草原、沙漠、林区核心区和边境禁区。'
      }
    }
  };

  const RAIN_WORDS = ['雨', '雪', '雹', '雷', '冻'];

  function getWeekendDates() {
    const today = new Date();
    const day = today.getDay();
    const daysToSaturday = day === 0 ? -1 : (6 - day + 7) % 7;
    const saturday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysToSaturday);
    const sunday = new Date(saturday.getFullYear(), saturday.getMonth(), saturday.getDate() + 1);
    const format = date => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const dateNumber = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${dateNumber}`;
    };
    return { saturday, sunday, start: format(saturday), end: format(sunday) };
  }

  async function fetchWeekendWeather(destination) {
    const payload = await requestAmapService('/v3/weather/weatherInfo', {
      city: destination.weatherCity,
      extensions: 'all'
    });
    const forecasts = payload.forecasts?.[0]?.casts;
    if (!forecasts?.length) throw new Error('高德天气预报暂不可用');

    const weekend = getWeekendDates();
    const weekendForecasts = forecasts.filter(item => item.date === weekend.start || item.date === weekend.end);
    const selected = weekendForecasts.length === 2 ? weekendForecasts : forecasts.slice(0, 2);
    return selected.map(item => ({
      date: item.date,
      week: item.week,
      condition: item.dayweather,
      max: Math.round(Number(item.daytemp)),
      min: Math.round(Number(item.nighttemp)),
      windDirection: item.daywind,
      windPower: item.daypower
    }));
  }

  function isRainy(days) {
    return days.some(day => RAIN_WORDS.some(word => day.condition.includes(word)));
  }

  function getWeatherIcon(condition) {
    if (condition.includes('雷')) return 'fa-cloud-bolt';
    if (condition.includes('雪')) return 'fa-snowflake';
    if (condition.includes('雨')) return condition.includes('晴') ? 'fa-cloud-sun-rain' : 'fa-cloud-rain';
    if (condition.includes('雾') || condition.includes('霾')) return 'fa-smog';
    if (condition.includes('阴')) return 'fa-cloud';
    if (condition.includes('云')) return 'fa-cloud-sun';
    if (condition.includes('晴')) return 'fa-sun';
    return 'fa-cloud-sun';
  }

  function shortDate(value) {
    const date = new Date(`${value}T12:00:00`);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function weatherDaysMarkup(days, compact = false) {
    return days.map(day => {
      const icon = getWeatherIcon(day.condition);
      const weekday = ['日', '一', '二', '三', '四', '五', '六'][Number(day.week)] || day.week;
      return `<div class="weather-day${compact ? ' weather-day--compact' : ''}">
        <div class="weather-day__name">周${weekday} · ${shortDate(day.date)}</div>
        <i class="fas ${icon}" aria-hidden="true"></i>
        <div><strong>${day.condition}</strong> ${day.min}~${day.max}℃</div>
        <small>${day.windDirection}风 ${day.windPower}级</small>
      </div>`;
    }).join('');
  }

  function updateInlineWeather(days, destination) {
    const weatherElement = document.getElementById('weather-info');
    if (!weatherElement) return;
    weatherElement.textContent = `${destination.weatherLabel}：${days.map(day => `${shortDate(day.date)} ${day.condition} ${day.min}~${day.max}℃`).join('；')}`;
  }

  function renderHomeWeather(card, key, destination) {
    let host = card.querySelector('.route-weather');
    if (!host) {
      host = document.createElement('div');
      host.className = 'route-weather';
      const meta = card.querySelector('.route-meta, .route-facts');
      (meta || card.querySelector('.route-content')).insertAdjacentElement(meta ? 'afterend' : 'afterbegin', host);
    }
    host.innerHTML = '<span class="weather-loading"><i class="fas fa-spinner fa-spin"></i> 正在获取近期天气</span>';
    fetchWeekendWeather(destination).then(days => {
      updateInlineWeather(days, destination);
      const mode = isRainy(days) ? 'rainy' : 'sunny';
      host.innerHTML = `<div class="route-weather__days">${weatherDaysMarkup(days, true)}</div>
        <span class="weather-mode weather-mode--${mode}">${mode === 'rainy' ? '雨天攻略已备好' : '晴天攻略已推荐'}</span>`;
      card.dataset.weatherMode = mode;
    }).catch(() => {
      host.innerHTML = `<button class="weather-retry" type="button"><i class="fas fa-rotate-right"></i> 天气加载失败，点击重试</button>`;
      host.querySelector('button').addEventListener('click', () => renderHomeWeather(card, key, destination));
    });
  }

  function templateMarkup(template, mode, selected) {
    return `<article class="weather-plan${selected ? ' is-active' : ''}" data-plan="${mode}" ${selected ? '' : 'hidden'}>
      <div class="weather-plan__heading">
        <span class="weather-plan__icon"><i class="fas ${mode === 'sunny' ? 'fa-sun' : 'fa-umbrella'}"></i></span>
        <div><h3>${template.title}</h3><p>${template.summary}</p></div>
      </div>
      <ol>${template.stops.map(stop => `<li>${stop}</li>`).join('')}</ol>
      <p class="weather-plan__tip"><i class="fas fa-circle-info"></i> ${template.tips}</p>
    </article>`;
  }

  function setActivePlan(section, mode) {
    section.querySelectorAll('[data-plan]').forEach(plan => {
      const active = plan.dataset.plan === mode;
      plan.hidden = !active;
      plan.classList.toggle('is-active', active);
    });
    document.dispatchEvent(new CustomEvent('weather-plan-change', { detail: { mode } }));
  }

  function renderDetailWeather(key, destination) {
    const main = document.querySelector('main.container');
    if (!main) return;
    const section = document.createElement('section');
    section.className = 'weekend-weather';
    section.innerHTML = `<div class="weather-section__top">
        <div><span class="weather-eyebrow">实时行程助手</span><h2><i class="fas fa-cloud-sun"></i> 近期天气攻略</h2></div>
        <span class="weather-updated">数据加载中</span>
      </div>
      <div class="weather-detail-loading"><i class="fas fa-spinner fa-spin"></i><p>正在获取${destination.name}近期预报…</p></div>`;
    main.insertAdjacentElement('afterbegin', section);

    const load = () => {
      fetchWeekendWeather(destination).then(days => {
        updateInlineWeather(days, destination);
        const recommended = isRainy(days) ? 'rainy' : 'sunny';
        section.innerHTML = `<div class="weather-section__top">
            <div><span class="weather-eyebrow">实时行程助手</span><h2><i class="fas fa-cloud-sun"></i> 近期天气攻略</h2></div>
            <span class="weather-updated">${shortDate(days[0].date)}–${shortDate(days[1].date)} · 动态预报</span>
          </div>
          <div class="weather-detail-grid">${weatherDaysMarkup(days)}</div>
          <div class="weather-recommendation weather-recommendation--${recommended}">
            <i class="fas ${recommended === 'rainy' ? 'fa-umbrella' : 'fa-sun'}"></i>
            根据近期两天的预报，当前推荐<strong>${recommended === 'rainy' ? '雨天版' : '晴天版'}</strong>攻略
          </div>
          ${templateMarkup(destination.sunny, 'sunny', recommended === 'sunny')}
          ${templateMarkup(destination.rainy, 'rainy', recommended === 'rainy')}
          <p class="weather-source">天气数据来自高德地图，出发前请再次确认当地预警与景区开放状态。</p>`;
        setActivePlan(section, requestedPlanMode || recommended);
      }).catch(() => {
        section.innerHTML = `<div class="weather-error"><i class="fas fa-cloud-bolt"></i><div><h2>天气暂时加载失败</h2><p>原攻略仍可正常查看，恢复网络后可重新获取。</p></div><button class="btn weather-retry-button" type="button">重新获取</button></div>`;
        section.querySelector('button').addEventListener('click', () => {
          section.remove();
          renderDetailWeather(key, destination);
        });
      });
    };
    load();
  }

  document.addEventListener('weather-plan-request', event => {
    const section = document.querySelector('.weekend-weather');
    const mode = event.detail?.mode;
    if (!['sunny', 'rainy'].includes(mode)) return;
    requestedPlanMode = mode;
    if (section?.querySelector('[data-plan]')) setActivePlan(section, mode);
  });

  function currentDestinationKey() {
    const match = window.location.pathname.match(/\/routes\/([^/.]+)\.html$/i);
    return match ? match[1].toLowerCase() : null;
  }

  function initHomeWeatherCards() {
    if (document.querySelector('.destinations-grid')) {
      document.querySelectorAll('.destinations-grid .route-card').forEach(card => {
        if (card.querySelector('.route-weather')) return;
        const link = card.querySelector('a[href*="routes/"]');
        const match = link && link.getAttribute('href').match(/routes\/([^/.]+)\.html/i);
        const cardKey = match && match[1].toLowerCase();
        if (cardKey && DESTINATIONS[cardKey]) renderHomeWeather(card, cardKey, DESTINATIONS[cardKey]);
      });
    }
  }

  function initWeekendWeather() {
    const key = currentDestinationKey();
    if (key && DESTINATIONS[key]) renderDetailWeather(key, DESTINATIONS[key]);
    if (!document.getElementById('route-catalog')) initHomeWeatherCards();
  }

  document.addEventListener('route-catalog-rendered', initHomeWeatherCards);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWeekendWeather);
  } else {
    initWeekendWeather();
  }
})();

// Shared navigation and interaction enhancements for every page.
(function () {
  const isRoutePage = /\/routes\/[^/]+\.html$/i.test(window.location.pathname);
  const isNestedPage = /\/(?:routes|categories)\/[^/]+\.html$/i.test(window.location.pathname);
  const assetPrefix = isNestedPage ? '../' : '';
  const chickAsset = `${assetPrefix}assets/img/title.svg`;

  function normalizePath(pathname) {
    return pathname.replace(/\/index\.html$/i, '/').replace(/\/$/, '').toLowerCase();
  }

  function addAccessibilityBasics() {
    document.documentElement.classList.add('js-enabled');
    const main = document.querySelector('main');
    if (!main) return;
    main.id = main.id || 'main-content';

    if (!document.querySelector('.skip-link')) {
      const skipLink = document.createElement('a');
      skipLink.className = 'skip-link';
      skipLink.href = `#${main.id}`;
      skipLink.textContent = '跳到主要内容';
      document.body.prepend(skipLink);
    }

    document.querySelectorAll('a[target="_blank"]').forEach(link => {
      link.rel = 'noopener noreferrer';
    });
  }

  function initReadingProgress() {
    const progress = document.createElement('div');
    progress.className = 'reading-progress';
    progress.setAttribute('aria-hidden', 'true');
    document.body.append(progress);

    let ticking = false;
    const update = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const value = scrollable > 0 ? Math.min(100, Math.max(0, window.scrollY / scrollable * 100)) : 0;
      progress.style.width = `${value}%`;
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });
    update();
  }

  function initNavigation() {
    const nav = document.querySelector('.nav-bar');
    const links = nav && nav.querySelector('.nav-links');
    if (!nav || !links) return;

    const brandImage = nav.querySelector('.nav-brand img');
    if (brandImage) brandImage.alt = 'Q版小鸡标志';

    const current = normalizePath(window.location.pathname);
    const routeCategory = isRoutePage
      ? document.body.dataset.routeCategory || 'shenzhen-nearby'
      : null;
    links.querySelectorAll('.nav-link').forEach(link => {
      const target = normalizePath(new URL(link.href, window.location.href).pathname);
      const active = target === current || link.dataset.category === routeCategory;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    const toggle = document.createElement('button');
    toggle.className = 'nav-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', '打开目的地菜单');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<i class="fas fa-bars" aria-hidden="true"></i>';
    links.id = links.id || 'site-navigation';
    toggle.setAttribute('aria-controls', links.id);
    links.insertAdjacentElement('beforebegin', toggle);

    const setOpen = open => {
      nav.classList.toggle('is-open', open);
      document.body.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? '关闭目的地菜单' : '打开目的地菜单');
      toggle.innerHTML = `<i class="fas ${open ? 'fa-xmark' : 'fa-bars'}" aria-hidden="true"></i>`;
    };

    toggle.addEventListener('click', event => {
      event.stopPropagation();
      setOpen(!nav.classList.contains('is-open'));
    });
    nav.addEventListener('click', event => event.stopPropagation());
    links.addEventListener('click', event => {
      if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('click', event => {
      if (nav.classList.contains('is-open') && !nav.contains(event.target)) setOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        setOpen(false);
        toggle.focus();
      }
    });
    const desktopQuery = window.matchMedia('(min-width: 761px)');
    desktopQuery.addEventListener('change', event => {
      if (event.matches) setOpen(false);
    });
  }

  function enhanceHero() {
    const hero = document.querySelector('.hero, .home-hero');
    if (!hero || hero.querySelector('.hero-chick')) return;
    const container = hero.querySelector('.container');
    if (!container) return;

    if (hero.classList.contains('home-hero')) {
      const kicker = document.createElement('span');
      kicker.className = 'home-kicker';
      kicker.innerHTML = '<i class="fas fa-compass" aria-hidden="true"></i> 周末出发，轻松做攻略';
      container.prepend(kicker);
    }

    const heroMessage = hero.classList.contains('home-hero')
      ? '跟着鸡哥去旅行'
      : hero.classList.contains('category-hero') ? '下一程，慢慢挑' : '行程已经整理好啦';
    const chick = document.createElement('div');
    chick.className = 'hero-chick';
    chick.innerHTML = `<img src="${chickAsset}" alt="Q版小鸡向导"><span>${heroMessage}</span>`;
    container.append(chick);
  }

  function enhanceRouteCards() {
    document.querySelectorAll('.destinations-grid .route-card').forEach(card => {
      const title = card.querySelector('.route-title')?.textContent.trim() || '旅游路线';
      const image = card.querySelector('.route-img');
      if (image) {
        image.setAttribute('role', 'img');
        image.setAttribute('aria-label', `${title}风景图`);
      }
      const button = card.querySelector('.btn');
      if (button && !button.querySelector('i')) {
        button.insertAdjacentHTML('beforeend', '<i class="fas fa-arrow-right" aria-hidden="true"></i>');
      }
    });
  }

  function initSectionNavigation() {
    const hero = document.querySelector('.hero');
    const main = document.querySelector('main');
    if (!hero || !main) return;
    if (isRoutePage && !main.querySelector('.trip-decision-section')) return;

    document.querySelector('.section-nav')?.remove();

    const items = [...main.querySelectorAll(':scope > section')].map((section, index) => {
      const heading = section.querySelector(':scope > h2, .weather-section__top h2, .trip-decision__heading h2');
      if (!heading) return null;
      section.id = section.id || `guide-section-${index + 1}`;
      return { section, label: heading.textContent.replace(/\s+/g, ' ').trim() };
    }).filter(Boolean);
    if (items.length < 3) return;

    const nav = document.createElement('nav');
    nav.className = 'section-nav';
    nav.setAttribute('aria-label', '本页章节');
    nav.innerHTML = `<div class="section-nav__inner">${items.map((item, index) =>
      `<a href="#${item.section.id}"${index === 0 ? ' class="is-active"' : ''}>${item.label}</a>`
    ).join('')}</div>`;
    hero.insertAdjacentElement('afterend', nav);

    const sectionLinks = [...nav.querySelectorAll('a')];
    const sectionScroller = nav.querySelector('.section-nav__inner');
    let activeSectionId = items[0].section.id;

    // Keep the active tab visible without moving the page vertically.
    const revealSectionLink = (link, behavior = 'smooth') => {
      const padding = 12;
      const linkStart = link.offsetLeft;
      const linkEnd = linkStart + link.offsetWidth;
      const visibleStart = sectionScroller.scrollLeft;
      const visibleEnd = visibleStart + sectionScroller.clientWidth;

      if (linkStart < visibleStart + padding) {
        sectionScroller.scrollTo({ left: Math.max(0, linkStart - padding), behavior });
      } else if (linkEnd > visibleEnd - padding) {
        sectionScroller.scrollTo({
          left: linkEnd - sectionScroller.clientWidth + padding,
          behavior
        });
      }
    };

    sectionLinks.forEach(link => {
      link.addEventListener('click', () => revealSectionLink(link));
    });

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        if (visible.target.id === activeSectionId) return;
        activeSectionId = visible.target.id;
        sectionLinks.forEach(link => {
          const active = link.getAttribute('href') === `#${visible.target.id}`;
          link.classList.toggle('is-active', active);
          if (active) revealSectionLink(link);
        });
      }, { rootMargin: '-28% 0px -62% 0px', threshold: [0, 0.1, 0.4] });
      items.forEach(item => observer.observe(item.section));
    }
  }

  function scrollToFirst(selectors) {
    const target = selectors.map(selector => document.querySelector(selector)).find(Boolean);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return Boolean(target);
  }

  function initChickGuide() {
    const guide = document.createElement('aside');
    guide.className = 'chick-guide';
    guide.innerHTML = `<button class="chick-guide__trigger" type="button" aria-label="打开小鸡向导" aria-expanded="false">
        <img src="${chickAsset}" alt=""><span>小鸡向导</span>
      </button>
      <div class="chick-guide__panel" hidden>
        <div class="chick-guide__header">
          <img src="${chickAsset}" alt="Q版小鸡">
          <div><strong>小鸡向导</strong><small>出发前，先看行程重点</small></div>
          <button class="chick-guide__close" type="button" aria-label="关闭小鸡向导"><i class="fas fa-xmark"></i></button>
        </div>
        ${isRoutePage ? `<div class="chick-guide__weather" role="group" aria-label="切换天气攻略">
          <span>天气攻略</span>
          <div class="chick-guide__weather-tabs">
            <button type="button" data-guide-weather="sunny" aria-pressed="false"><i class="fas fa-sun"></i><span>晴天</span></button>
            <button type="button" data-guide-weather="rainy" aria-pressed="false"><i class="fas fa-umbrella"></i><span>雨天</span></button>
          </div>
        </div>` : ''}
        <div class="chick-guide__actions">
          <button type="button" data-guide-action="weather"><i class="fas fa-cloud-sun"></i><span>查看近期天气</span><i class="fas fa-chevron-right"></i></button>
          <button type="button" data-guide-action="plan"><i class="fas fa-route"></i><span>${isRoutePage ? '跳到详细行程' : '浏览热门路线'}</span><i class="fas fa-chevron-right"></i></button>
          <button type="button" data-guide-action="map"><i class="fas fa-map-location-dot"></i><span>${isRoutePage ? '查看路线地图' : '查看出行建议'}</span><i class="fas fa-chevron-right"></i></button>
          <button type="button" data-guide-action="share"><i class="fas fa-share-nodes"></i><span>分享当前攻略</span><i class="fas fa-chevron-right"></i></button>
          <button type="button" data-guide-action="top"><i class="fas fa-arrow-up"></i><span>返回页面顶部</span><i class="fas fa-chevron-right"></i></button>
        </div>
      </div>`;
    document.body.append(guide);

    const trigger = guide.querySelector('.chick-guide__trigger');
    const panel = guide.querySelector('.chick-guide__panel');
    const close = guide.querySelector('.chick-guide__close');
    const setOpen = open => {
      panel.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      trigger.setAttribute('aria-label', open ? '关闭小鸡向导' : '打开小鸡向导');
      if (open) close.focus();
    };

    trigger.addEventListener('click', () => setOpen(panel.hidden));
    close.addEventListener('click', () => {
      setOpen(false);
      trigger.focus();
    });
    document.addEventListener('click', event => {
      if (!panel.hidden && !guide.contains(event.target)) setOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel.hidden) {
        setOpen(false);
        trigger.focus();
      }
    });

    const syncWeatherTabs = mode => {
      guide.querySelectorAll('[data-guide-weather]').forEach(button => {
        const active = button.dataset.guideWeather === mode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    };
    document.addEventListener('weather-plan-change', event => syncWeatherTabs(event.detail?.mode));
    guide.querySelector('.chick-guide__weather-tabs')?.addEventListener('click', event => {
      const button = event.target.closest('button[data-guide-weather]');
      if (!button) return;
      document.dispatchEvent(new CustomEvent('weather-plan-request', {
        detail: { mode: button.dataset.guideWeather }
      }));
      syncWeatherTabs(button.dataset.guideWeather);
      scrollToFirst(['.weekend-weather']);
      setOpen(false);
    });

    guide.querySelector('.chick-guide__actions').addEventListener('click', async event => {
      const button = event.target.closest('button[data-guide-action]');
      if (!button) return;
      const action = button.dataset.guideAction;
      if (action === 'weather') scrollToFirst(['.weekend-weather', '.route-weather']);
      if (action === 'plan') scrollToFirst(isRoutePage ? ['.itinerary-section', '.content-section'] : ['.destinations-grid']);
      if (action === 'map') scrollToFirst(isRoutePage ? ['.map-section', '.map-container'] : ['.tips-section']);
      if (action === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
      if (action === 'share') {
        const label = button.querySelector('span');
        try {
          if (navigator.share) await navigator.share({ title: document.title, url: window.location.href });
          else {
            await navigator.clipboard.writeText(window.location.href);
            label.textContent = '链接已复制';
            setTimeout(() => { label.textContent = '分享当前攻略'; }, 1800);
          }
        } catch (error) {
          if (error.name !== 'AbortError') {
            label.textContent = '请复制浏览器地址';
            setTimeout(() => { label.textContent = '分享当前攻略'; }, 1800);
          }
        }
      }
      if (action !== 'share') setOpen(false);
    });
  }

  function enhanceFooter() {
    const footer = document.querySelector('footer');
    if (!footer || footer.querySelector('.footer-chick')) return;
    const chick = document.createElement('img');
    chick.className = 'footer-chick';
    chick.src = chickAsset;
    chick.alt = '';
    footer.prepend(chick);
  }

  function initTravelGuideUI() {
    addAccessibilityBasics();
    initReadingProgress();
    initNavigation();
    enhanceHero();
    enhanceRouteCards();
    initSectionNavigation();
    initChickGuide();
    enhanceFooter();
  }

  document.addEventListener('route-detail-rendered', initSectionNavigation);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTravelGuideUI);
  } else {
    initTravelGuideUI();
  }
})();
