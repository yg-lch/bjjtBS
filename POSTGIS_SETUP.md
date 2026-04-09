# PostGIS路径规划功能设置说明

## 1. 数据库设置

### 1.1 安装必要的扩展
```sql
-- 安装PostGIS扩展
CREATE EXTENSION IF NOT EXISTS postgis;

-- 检查PostGIS版本
SELECT PostGIS_Version();
```

### 1.2 检查道路数据
```sql
-- 查看道路数据统计
SELECT COUNT(*) as total_roads FROM "Road";
SELECT COUNT(*) as valid_roads FROM "Road" WHERE geom IS NOT NULL AND ST_IsValid(geom);

-- 查看道路数据范围
SELECT 
    ST_XMin(ST_Extent(geom)) as min_x,
    ST_YMin(ST_Extent(geom)) as min_y,
    ST_XMax(ST_Extent(geom)) as max_x,
    ST_YMax(ST_Extent(geom)) as max_y
FROM "Road";
```

### 1.3 创建路径规划函数
执行 `postgis_route_test.sql` 文件中的SQL语句，创建路径规划函数。

## 2. API设置

### 2.1 安装Python依赖
```bash
pip install flask psycopg2-binary
```

### 2.2 配置数据库连接
编辑 `route_api_multi.py` 文件，修改数据库连接参数：

```python
DB_PARAMS = {
    'dbname': 'your_database',      # 修改为你的数据库名
    'user': 'postgres',             # 修改为你的用户名
    'password': 'your_password',     # 修改为你的密码
    'host': 'localhost',
    'port': '5432'
}
```

### 2.3 启动API服务
```bash
python route_api_multi.py
```

## 3. 测试步骤

### 3.1 健康检查
在浏览器中访问：
```
http://localhost:5000/api/health
```

### 3.2 测试时间最短路径
在浏览器中访问：
```
http://localhost:5000/api/route?start_lon=116.3&start_lat=39.9&end_lon=116.4&end_lat=39.9&mode=time
```

### 3.3 测试距离最短路径
在浏览器中访问：
```
http://localhost:5000/api/route?start_lon=116.3&start_lat=39.9&end_lon=116.4&end_lat=39.9&mode=distance
```

### 3.4 测试双路径对比
在浏览器中访问：
```
http://localhost:5000/api/multi-route?start_lon=116.3&start_lat=39.9&end_lon=116.4&end_lat=39.9
```

## 4. 前端集成

### 4.1 修改前端代码
编辑 `main.js` 文件，修改 `fetchRouteData` 函数：

```javascript
async function fetchRouteData(start, end) {
  try {
    // 调用PostGIS API
    const response = await fetch(
      `http://localhost:5000/api/route?start_lon=${start[0]}&start_lat=${start[1]}&end_lon=${end[0]}&end_lat=${end[1]}`
    );
    
    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.status !== 'success' || !data.route) {
      throw new Error('路径规划失败');
    }
    
    // 处理路径数据
    const coordinates = data.route.coordinates;
    
    return {
      coordinates: coordinates,
      distance: data.distance,
      duration: data.duration
    };
  } catch (error) {
    console.error('路径规划失败:', error);
    // 失败时返回null，让系统使用模拟路径
    return null;
  }
}
```

## 5. 故障排除

### 5.1 数据库连接失败
- 检查数据库服务是否运行
- 检查连接参数是否正确
- 检查防火墙设置

### 5.2 路径规划失败
- 检查道路数据是否有效
- 检查路径规划函数是否创建成功
- 查看API日志获取详细错误信息

### 5.3 CORS问题
如果前端无法访问API，可能需要处理CORS问题：

```python
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # 启用CORS支持
```

安装flask-cors：
```bash
pip install flask-cors
```

## 6. 性能优化

### 6.1 创建空间索引
```sql
CREATE INDEX IF NOT EXISTS road_geom_idx ON "Road" USING gist(geom);
```

### 6.2 优化查询
- 限制查询范围
- 使用空间索引
- 缓存常用路径

## 7. 注意事项

1. **坐标系**：确保道路数据使用WGS84坐标系（EPSG:4326）
2. **数据质量**：确保道路几何数据有效且连续
3. **性能**：对于大规模道路网络，考虑使用更专业的路径规划算法
4. **错误处理**：确保有完善的错误处理和备选方案

## 8. 后续改进

1. **使用pgRouting**：如果拓扑构建成功，可以使用pgRouting获得更精确的路径规划
2. **添加交通信息**：考虑添加实时交通数据
3. **多路径规划**：提供多种路径选择
4. **路径优化**：根据道路类型、限速等信息优化路径
