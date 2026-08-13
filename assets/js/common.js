const AMAP_KEY = 'cb06ef50e6a5d1787f67fdb7591a8303';
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
      const meta = card.querySelector('.route-meta');
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

  function initWeekendWeather() {
    const key = currentDestinationKey();
    if (key && DESTINATIONS[key]) renderDetailWeather(key, DESTINATIONS[key]);

    if (document.querySelector('.destinations-grid')) {
      document.querySelectorAll('.route-card').forEach(card => {
        const link = card.querySelector('a[href*="routes/"]');
        const match = link && link.getAttribute('href').match(/routes\/([^/.]+)\.html/i);
        const cardKey = match && match[1].toLowerCase();
        if (cardKey && DESTINATIONS[cardKey]) renderHomeWeather(card, cardKey, DESTINATIONS[cardKey]);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWeekendWeather);
  } else {
    initWeekendWeather();
  }
})();

// Shared navigation and interaction enhancements for every page.
(function () {
  const isRoutePage = /\/routes\/[^/]+\.html$/i.test(window.location.pathname);
  const assetPrefix = isRoutePage ? '../' : '';
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
    links.querySelectorAll('.nav-link').forEach(link => {
      const target = normalizePath(new URL(link.href, window.location.href).pathname);
      const active = target === current;
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

    const chick = document.createElement('div');
    chick.className = 'hero-chick';
    chick.innerHTML = `<img src="${chickAsset}" alt="Q版小鸡向导"><span>${hero.classList.contains('home-hero') ? '跟着鸡哥去旅行' : '行程已经整理好啦'}</span>`;
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

    const items = [...main.querySelectorAll(':scope > section')].map((section, index) => {
      const heading = section.querySelector(':scope > h2, .weather-section__top h2');
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTravelGuideUI);
  } else {
    initTravelGuideUI();
  }
})();
