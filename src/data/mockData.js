export const roadFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        roadId: 1,
        name: 'G6 京藏高速',
        roadType: 'highway',
        typeLabel: '高速公路',
        status: '畅通',
        speedLimit: 100,
        currentSpeed: 82
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [116.2502, 39.9891],
          [116.3124, 39.9848],
          [116.3662, 39.9764],
          [116.4218, 39.9716]
        ]
      }
    },
    {
      type: 'Feature',
      properties: {
        roadId: 2,
        name: '京承高速',
        roadType: 'highway',
        typeLabel: '高速公路',
        status: '缓慢',
        speedLimit: 100,
        currentSpeed: 54
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [116.4102, 40.0058],
          [116.4623, 40.0304],
          [116.5151, 40.0722],
          [116.5594, 40.1182]
        ]
      }
    },
    {
      type: 'Feature',
      properties: {
        roadId: 3,
        name: 'G109 京拉线',
        roadType: 'national',
        typeLabel: '国道',
        status: '拥堵',
        speedLimit: 80,
        currentSpeed: 28
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [116.1981, 39.9325],
          [116.2524, 39.9261],
          [116.3186, 39.9218],
          [116.3798, 39.9184]
        ]
      }
    },
    {
      type: 'Feature',
      properties: {
        roadId: 4,
        name: 'G101 京沈线',
        roadType: 'national',
        typeLabel: '国道',
        status: '缓慢',
        speedLimit: 80,
        currentSpeed: 46
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [116.4472, 39.8803],
          [116.5029, 39.8892],
          [116.5604, 39.9053],
          [116.6128, 39.9287]
        ]
      }
    },
    {
      type: 'Feature',
      properties: {
        roadId: 5,
        name: 'S321 通武线',
        roadType: 'provincial',
        typeLabel: '省道',
        status: '畅通',
        speedLimit: 60,
        currentSpeed: 51
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [116.5242, 39.8254],
          [116.5608, 39.8527],
          [116.6034, 39.8711],
          [116.6489, 39.8898]
        ]
      }
    },
    {
      type: 'Feature',
      properties: {
        roadId: 6,
        name: 'S230 顺平路',
        roadType: 'provincial',
        typeLabel: '省道',
        status: '缓慢',
        speedLimit: 60,
        currentSpeed: 39
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [116.6703, 40.1138],
          [116.6205, 40.0811],
          [116.5719, 40.0494],
          [116.5276, 40.0166]
        ]
      }
    },
    {
      type: 'Feature',
      properties: {
        roadId: 7,
        name: 'X005 怀长路',
        roadType: 'county',
        typeLabel: '县道',
        status: '畅通',
        speedLimit: 40,
        currentSpeed: 34
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [116.0761, 40.3232],
          [116.1125, 40.3034],
          [116.1452, 40.2811],
          [116.1828, 40.2567]
        ]
      }
    },
    {
      type: 'Feature',
      properties: {
        roadId: 8,
        name: 'X007 密云西统路',
        roadType: 'county',
        typeLabel: '县道',
        status: '拥堵',
        speedLimit: 40,
        currentSpeed: 18
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [116.8681, 40.4488],
          [116.8932, 40.4261],
          [116.9158, 40.3966],
          [116.9341, 40.3684]
        ]
      }
    }
  ]
};

export const poiFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        poiId: 1,
        name: '北京交通大学',
        category: 'school',
        categoryLabel: '学校'
      },
      geometry: {
        type: 'Point',
        coordinates: [116.3488, 39.9547]
      }
    },
    {
      type: 'Feature',
      properties: {
        poiId: 2,
        name: '积水潭医院',
        category: 'hospital',
        categoryLabel: '医院'
      },
      geometry: {
        type: 'Point',
        coordinates: [116.3737, 39.9479]
      }
    },
    {
      type: 'Feature',
      properties: {
        poiId: 3,
        name: '国贸公交站',
        category: 'bus',
        categoryLabel: '公交站'
      },
      geometry: {
        type: 'Point',
        coordinates: [116.4591, 39.9075]
      }
    },
    {
      type: 'Feature',
      properties: {
        poiId: 4,
        name: '北京南站公交枢纽',
        category: 'bus',
        categoryLabel: '公交站'
      },
      geometry: {
        type: 'Point',
        coordinates: [116.3859, 39.8717]
      }
    },
    {
      type: 'Feature',
      properties: {
        poiId: 5,
        name: '北京友谊医院',
        category: 'hospital',
        categoryLabel: '医院'
      },
      geometry: {
        type: 'Point',
        coordinates: [116.3654, 39.8948]
      }
    },
    {
      type: 'Feature',
      properties: {
        poiId: 6,
        name: '北京四中',
        category: 'school',
        categoryLabel: '学校'
      },
      geometry: {
        type: 'Point',
        coordinates: [116.3722, 39.9345]
      }
    },
    {
      type: 'Feature',
      properties: {
        poiId: 7,
        name: '北京大学',
        category: 'school',
        categoryLabel: '学校'
      },
      geometry: {
        type: 'Point',
        coordinates: [116.3055, 39.9982]
      }
    },
    {
      type: 'Feature',
      properties: {
        poiId: 8,
        name: '清华大学',
        category: 'school',
        categoryLabel: '学校'
      },
      geometry: {
        type: 'Point',
        coordinates: [116.3274, 40.0016]
      }
    },
    {
      type: 'Feature',
      properties: {
        poiId: 9,
        name: '北京协和医院',
        category: 'hospital',
        categoryLabel: '医院'
      },
      geometry: {
        type: 'Point',
        coordinates: [116.4004, 39.9122]
      }
    },
    {
      type: 'Feature',
      properties: {
        poiId: 10,
        name: '北京大学人民医院',
        category: 'hospital',
        categoryLabel: '医院'
      },
      geometry: {
        type: 'Point',
        coordinates: [116.3638, 39.9272]
      }
    },
    {
      type: 'Feature',
      properties: {
        poiId: 11,
        name: '天安门东公交站',
        category: 'bus',
        categoryLabel: '公交站'
      },
      geometry: {
        type: 'Point',
        coordinates: [116.3977, 39.9186]
      }
    },
    {
      type: 'Feature',
      properties: {
        poiId: 12,
        name: '中关村公交站',
        category: 'bus',
        categoryLabel: '公交站'
      },
      geometry: {
        type: 'Point',
        coordinates: [116.3190, 39.9846]
      }
    }
  ]
};

export const trafficAlerts = [
  {
    id: 1,
    level: '高',
    title: 'G109 京拉线拥堵加剧',
    description: '西向进城方向平均车速下降至 28 km/h，建议触发疏导方案。',
    time: '10:20'
  },
  {
    id: 2,
    level: '中',
    title: '京承高速车流增大',
    description: '北向路段出现排队迹象，建议重点监测收费站入口。',
    time: '10:12'
  },
  {
    id: 3,
    level: '中',
    title: '密云西统路发生事件',
    description: '县道路段出现短时拥堵，可联动发布绕行信息。',
    time: '09:56'
  }
];
