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

// Weekend weather and weather-aware itinerary rendering.
(function () {
  const DESTINATIONS = {
    dapeng: {
      name: '大鹏半岛', latitude: 22.55, longitude: 114.54,
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
      name: '南澳岛', latitude: 23.43, longitude: 117.03,
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
      name: '广州', latitude: 23.13, longitude: 113.26,
      sunny: {
        title: '晴天版 · 新城与西关漫游', summary: '晴天适合串联城市天际线、历史街区和珠江两岸。',
        stops: ['周六傍晚：花城广场、海心沙与广州塔', '周日上午：陈家祠与永庆坊', '周日下午：沙面岛散步，珠江边收尾'],
        tips: '午后炎热时把早茶和展馆作为休息点，户外步行集中在早晚。'
      },
      rainy: {
        title: '雨天版 · 地铁室内文化线', summary: '用地铁连接馆舍和老字号，把长距离户外步行压缩到最少。',
        stops: ['周六：广东省博物馆或正佳广场', '周日：陈家祠、粤剧艺术博物馆', '餐饮：早茶加北京路商圈，按雨势短途步行'],
        tips: '预留地铁换乘时间；暴雨时取消珠江夜游，并留意场馆预约与闭馆日。'
      }
    },
    zhuhai: {
      name: '珠海', latitude: 22.27, longitude: 113.58,
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
      name: '阳江', latitude: 21.86, longitude: 111.98,
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
      name: '清远·佛山·江门', latitude: 23.68, longitude: 113.06,
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

  const WEATHER_CODES = {
    0: ['晴', 'fa-sun'], 1: ['大致晴朗', 'fa-sun'], 2: ['多云', 'fa-cloud-sun'],
    3: ['阴', 'fa-cloud'], 45: ['雾', 'fa-smog'], 48: ['雾凇', 'fa-smog'],
    51: ['毛毛雨', 'fa-cloud-rain'], 53: ['毛毛雨', 'fa-cloud-rain'], 55: ['较强毛毛雨', 'fa-cloud-rain'],
    56: ['冻毛毛雨', 'fa-cloud-rain'], 57: ['较强冻毛毛雨', 'fa-cloud-rain'],
    61: ['小雨', 'fa-cloud-rain'], 63: ['中雨', 'fa-cloud-showers-heavy'], 65: ['大雨', 'fa-cloud-showers-heavy'],
    66: ['冻雨', 'fa-cloud-rain'], 67: ['较强冻雨', 'fa-cloud-showers-heavy'],
    71: ['小雪', 'fa-snowflake'], 73: ['中雪', 'fa-snowflake'], 75: ['大雪', 'fa-snowflake'], 77: ['雪粒', 'fa-snowflake'],
    80: ['阵雨', 'fa-cloud-sun-rain'], 81: ['较强阵雨', 'fa-cloud-showers-heavy'], 82: ['强阵雨', 'fa-cloud-showers-heavy'],
    85: ['阵雪', 'fa-snowflake'], 86: ['强阵雪', 'fa-snowflake'],
    95: ['雷雨', 'fa-cloud-bolt'], 96: ['雷雨伴冰雹', 'fa-cloud-bolt'], 99: ['强雷雨伴冰雹', 'fa-cloud-bolt']
  };

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
    const weekend = getWeekendDates();
    const params = new URLSearchParams({
      latitude: destination.latitude,
      longitude: destination.longitude,
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
      timezone: 'Asia/Shanghai',
      start_date: weekend.start,
      end_date: weekend.end
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
    const payload = await response.json();
    if (!payload.daily || payload.daily.time.length < 2) throw new Error('Weekend forecast unavailable');
    return payload.daily.time.map((date, index) => ({
      date,
      code: payload.daily.weather_code[index],
      max: Math.round(payload.daily.temperature_2m_max[index]),
      min: Math.round(payload.daily.temperature_2m_min[index]),
      rainChance: Math.round(payload.daily.precipitation_probability_max[index] || 0),
      precipitation: payload.daily.precipitation_sum[index] || 0
    }));
  }

  function isRainy(days) {
    return days.some(day => day.code >= 51 || day.rainChance >= 50 || day.precipitation >= 1);
  }

  function getWeatherMeta(code) {
    return WEATHER_CODES[code] || ['天气变化', 'fa-cloud'];
  }

  function shortDate(value) {
    const date = new Date(`${value}T12:00:00`);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function weatherDaysMarkup(days, compact = false) {
    return days.map((day, index) => {
      const [label, icon] = getWeatherMeta(day.code);
      return `<div class="weather-day${compact ? ' weather-day--compact' : ''}">
        <div class="weather-day__name">周${index === 0 ? '六' : '日'} · ${shortDate(day.date)}</div>
        <i class="fas ${icon}" aria-hidden="true"></i>
        <div><strong>${label}</strong> ${day.min}~${day.max}℃</div>
        <small>降雨概率 ${day.rainChance}%</small>
      </div>`;
    }).join('');
  }

  function renderHomeWeather(card, key, destination) {
    let host = card.querySelector('.route-weather');
    if (!host) {
      host = document.createElement('div');
      host.className = 'route-weather';
      const meta = card.querySelector('.route-meta');
      (meta || card.querySelector('.route-content')).insertAdjacentElement(meta ? 'afterend' : 'afterbegin', host);
    }
    host.innerHTML = '<span class="weather-loading"><i class="fas fa-spinner fa-spin"></i> 正在获取本周末天气</span>';
    fetchWeekendWeather(destination).then(days => {
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
    section.querySelectorAll('[data-weather-switch]').forEach(button => {
      const active = button.dataset.weatherSwitch === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    section.querySelectorAll('[data-plan]').forEach(plan => {
      const active = plan.dataset.plan === mode;
      plan.hidden = !active;
      plan.classList.toggle('is-active', active);
    });
  }

  function renderDetailWeather(key, destination) {
    const main = document.querySelector('main.container');
    if (!main) return;
    const section = document.createElement('section');
    section.className = 'weekend-weather';
    section.innerHTML = `<div class="weather-section__top">
        <div><span class="weather-eyebrow">实时行程助手</span><h2><i class="fas fa-cloud-sun"></i> 本周末天气攻略</h2></div>
        <span class="weather-updated">数据加载中</span>
      </div>
      <div class="weather-detail-loading"><i class="fas fa-spinner fa-spin"></i><p>正在获取${destination.name}本周末预报…</p></div>`;
    main.insertAdjacentElement('afterbegin', section);

    const load = () => {
      fetchWeekendWeather(destination).then(days => {
        const recommended = isRainy(days) ? 'rainy' : 'sunny';
        section.innerHTML = `<div class="weather-section__top">
            <div><span class="weather-eyebrow">实时行程助手</span><h2><i class="fas fa-cloud-sun"></i> 本周末天气攻略</h2></div>
            <span class="weather-updated">${shortDate(days[0].date)}–${shortDate(days[1].date)} · 动态预报</span>
          </div>
          <div class="weather-detail-grid">${weatherDaysMarkup(days)}</div>
          <div class="weather-recommendation weather-recommendation--${recommended}">
            <i class="fas ${recommended === 'rainy' ? 'fa-umbrella' : 'fa-sun'}"></i>
            根据周末两天的预报，当前推荐<strong>${recommended === 'rainy' ? '雨天版' : '晴天版'}</strong>攻略
          </div>
          <div class="weather-switcher" role="group" aria-label="攻略模板">
            <button type="button" data-weather-switch="sunny"><i class="fas fa-sun"></i> 晴天版</button>
            <button type="button" data-weather-switch="rainy"><i class="fas fa-umbrella"></i> 雨天版</button>
          </div>
          ${templateMarkup(destination.sunny, 'sunny', recommended === 'sunny')}
          ${templateMarkup(destination.rainy, 'rainy', recommended === 'rainy')}
          <p class="weather-source">天气数据来自 Open-Meteo，出发前请再次确认当地预警与景区开放状态。</p>`;
        section.querySelectorAll('[data-weather-switch]').forEach(button => {
          button.addEventListener('click', () => setActivePlan(section, button.dataset.weatherSwitch));
        });
        setActivePlan(section, recommended);
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
    sectionLinks.forEach(link => {
      link.addEventListener('click', () => link.scrollIntoView({ block: 'nearest', inline: 'center' }));
    });

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        sectionLinks.forEach(link => {
          const active = link.getAttribute('href') === `#${visible.target.id}`;
          link.classList.toggle('is-active', active);
          if (active) link.scrollIntoView({ block: 'nearest', inline: 'center' });
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
        <div class="chick-guide__actions">
          <button type="button" data-guide-action="weather"><i class="fas fa-cloud-sun"></i><span>查看周末天气</span><i class="fas fa-chevron-right"></i></button>
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
