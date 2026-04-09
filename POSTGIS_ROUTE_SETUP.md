# 路径规划API设置说明

## 1. 数据库设置

### 1.1 执行路径规划函数创建
在PostgreSQL中执行 `postgis_route_pgrouting.sql` 文件，创建路径规划函数。

### 1.2 验证数据结构
确保以下表存在：
- `road_single` - 道路数据表
- `road_single_vertices_pgr` - 道路节点表（由pgRouting创建）

## 2. API设置

### 2.1 安装Python依赖
```bash
pip install flask psycopg2-binary flask-cors
```

### 2.2 启动API服务
```bash
python route_api_multi.py
```

## 3. 前端设置

### 3.1 修改前端代码
编辑 `main.js` 文件，修改 `fetchRouteData` 函数：

```javascript
async function fetchRouteData(start, end) {
  try {
    const response = await fetch(
      `http://localhost:5000/api/multi-route?start_lon=${start[0]}&start_lat=${start[1]}&end_lon=${end[0]}&end_lat=${end[1]}`
    );
    
    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.status !== 'success' || !Array.isArray(data.routes) || data.routes.length === 0) {
      throw new Error('路径规划失败');
    }
    
    return data.routes;
  } catch (error) {
    console.error('路径规划失败:', error);
    throw error;
  }
}
```

## 4. 测试步骤

### 4.1 健康检查
在浏览器中访问：
```
http://localhost:5000/api/health
```

### 4.2 测试时间最短路径
在浏览器中访问：
```
http://localhost:5000/api/route?start_lon=116.3975&start_lat=39.9087&end_lon=116.3971&end_lat=39.9178&mode=time
```

### 4.3 测试距离最短路径
在浏览器中访问：
```
http://localhost:5000/api/route?start_lon=116.3975&start_lat=39.9087&end_lon=116.3971&end_lat=39.9178&mode=distance
```

### 4.4 测试双路径对比
在浏览器中访问：
```
http://localhost:5000/api/multi-route?start_lon=116.3975&start_lat=39.9087&end_lon=116.3971&end_lat=39.9178
```

## 5. 故障排除

### 5.1 数据库连接失败
- 检查数据库服务是否运行
- 检查连接参数是否正确
- 检查防火墙设置

### 5.2 路径规划失败
- 检查 `road_single` 表是否存在
- 检查 `road_single_vertices_pgr` 表是否存在
- 检查道路数据是否有效
- 查看API日志获取详细错误信息

### 5.3 CORS问题
已在API中启用CORS支持，应该不会出现跨域问题。

## 6. 性能优化

### 6.1 确保索引存在
```sql
-- 道路几何索引
CREATE INDEX IF NOT EXISTS road_single_geom_idx ON road_single USING gist(geom);

-- 节点几何索引
CREATE INDEX IF NOT EXISTS road_single_vertices_pgr_geom_idx ON road_single_vertices_pgr USING gist(the_geom);

-- 道路source和target索引
CREATE INDEX IF NOT EXISTS road_single_source_idx ON road_single(source);
CREATE INDEX IF NOT EXISTS road_single_target_idx ON road_single(target);
```

### 6.2 数据预处理
确保道路数据已经正确构建拓扑：
```sql
-- 重新构建拓扑
SELECT pgr_createTopology('road_single', 0.00001, 'geom', 'id');
```

## 7. 注意事项

1. **坐标系**：确保道路数据使用WGS84坐标系（EPSG:4326）
2. **数据质量**：确保道路几何数据有效且连续
3. **性能**：对于大规模道路网络，pgRouting会自动优化性能
4. **错误处理**：API已经包含完善的错误处理

## 8. 示例调用

### 8.1 双路径结果
```javascript
// 从天安门到故宫
const start = [116.3975, 39.9087]; // 天安门
const end = [116.3971, 39.9178];   // 故宫

const routes = await fetchRouteData(start, end);
console.log('距离最短:', routes.find((route) => route.route_key === 'distance'));
console.log('时间最短:', routes.find((route) => route.route_key === 'time'));
```

通过以上设置，您应该能够成功实现基于PostGIS和pgRouting的路径规划功能。
