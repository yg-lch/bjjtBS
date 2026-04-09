-- 根据用户提供的SQL语句更新路径规划函数
-- 这个脚本使用已有的road_single表和road_single_vertices_pgr节点表

-- 1. 检查road_single表和节点表
SELECT '=== 检查数据结构 ===' as test_name;
SELECT COUNT(*) as road_count FROM road_single;
SELECT COUNT(*) as node_count FROM road_single_vertices_pgr;

-- 2. 创建基于用户SQL的路径规划函数
CREATE OR REPLACE FUNCTION get_route_using_pgrouting(
    start_lon numeric, 
    start_lat numeric, 
    end_lon numeric, 
    end_lat numeric
)
RETURNS TABLE(
    route geometry,
    total_distance numeric,
    estimated_time numeric,
    node_count integer
) AS $$
DECLARE
    start_node_id integer;
    end_node_id integer;
    route_geom geometry;
    distance numeric;
    time_estimate numeric;
BEGIN
    -- 查找最近的起点节点
    SELECT id INTO start_node_id
    FROM road_single_vertices_pgr
    ORDER BY the_geom <-> ST_SetSRID(ST_MakePoint(start_lon, start_lat), 4326)
    LIMIT 1;
    
    -- 查找最近的终点节点
    SELECT id INTO end_node_id
    FROM road_single_vertices_pgr
    ORDER BY the_geom <-> ST_SetSRID(ST_MakePoint(end_lon, end_lat), 4326)
    LIMIT 1;
    
    -- 检查是否找到节点
    IF start_node_id IS NULL OR end_node_id IS NULL THEN
        RETURN QUERY
        SELECT NULL::geometry, 0::numeric, 0::numeric, 0::integer
        LIMIT 0;
        RETURN;
    END IF;
    
    -- 使用用户提供的SQL查询路径
    WITH path_raw AS (
        SELECT seq, node, edge
        FROM pgr_dijkstra(
            'SELECT id, source, target, cost, reverse_cost FROM road_single',
            start_node_id,
            end_node_id,
            directed := true
        )
    ),
    path AS (
        SELECT
            seq,
            node AS from_node,
            LEAD(node) OVER (ORDER BY seq) AS to_node,
            edge
        FROM path_raw
    ),
    ordered_edges AS (
        SELECT
            ROW_NUMBER() OVER (ORDER BY path.seq) AS edge_seq,
            CASE
                WHEN road_single.source = path.from_node AND road_single.target = path.to_node THEN road_single.geom
                WHEN road_single.target = path.from_node AND road_single.source = path.to_node THEN ST_Reverse(road_single.geom)
                ELSE road_single.geom
            END AS geom,
            road_single.cost
        FROM path
        JOIN road_single ON path.edge = road_single.id
        WHERE path.edge != -1 AND path.to_node IS NOT NULL
    ),
    path_points AS (
        SELECT
            ordered_edges.edge_seq,
            (dumped.path)[1] AS point_seq,
            dumped.geom AS geom
        FROM ordered_edges
        CROSS JOIN LATERAL ST_DumpPoints(ordered_edges.geom) AS dumped
        WHERE ordered_edges.edge_seq = 1 OR (dumped.path)[1] > 1
    ),
    route_line AS (
        SELECT ST_RemoveRepeatedPoints(
            ST_MakeLine(path_points.geom ORDER BY path_points.edge_seq, path_points.point_seq)
        ) AS geom
        FROM path_points
    ),
    route_stats AS (
        SELECT
            SUM(cost) AS total_distance,
            COUNT(*) AS node_count
        FROM ordered_edges
    )
    SELECT
        route_line.geom,
        route_stats.total_distance,
        route_stats.node_count
    INTO route_geom, distance, node_count
    FROM route_line
    CROSS JOIN route_stats;
    
    -- 检查是否找到路径
    IF route_geom IS NULL THEN
        RETURN QUERY
        SELECT NULL::geometry, 0::numeric, 0::numeric, 0::integer
        LIMIT 0;
        RETURN;
    END IF;
    
    -- 计算预计时间（假设平均速度42 km/h）
    time_estimate := (distance / 1000 / 42) * 60;
    
    RETURN QUERY
    SELECT route_geom, distance, time_estimate, node_count;
END;
$$ LANGUAGE plpgsql;

-- 3. 创建简化版路径规划函数（备用）
CREATE OR REPLACE FUNCTION get_route_simple(
    start_lon numeric, 
    start_lat numeric, 
    end_lon numeric, 
    end_lat numeric
)
RETURNS TABLE(
    route geometry,
    total_distance numeric,
    estimated_time numeric
) AS $$
DECLARE
    route_geom geometry;
    distance numeric;
    time_estimate numeric;
BEGIN
    -- 使用用户提供的SQL结构，但简化为直接连接
    WITH 
    start_pt AS (SELECT ST_SetSRID(ST_MakePoint(start_lon, start_lat), 4326) AS geom),
    end_pt   AS (SELECT ST_SetSRID(ST_MakePoint(end_lon, end_lat), 4326) AS geom),
    
    start_node AS (
        SELECT id FROM road_single_vertices_pgr
        ORDER BY the_geom <-> (SELECT geom FROM start_pt) LIMIT 1
    ),
    end_node AS (
        SELECT id FROM road_single_vertices_pgr
        ORDER BY the_geom <-> (SELECT geom FROM end_pt) LIMIT 1
    ),
    
    path_raw AS (
        SELECT seq, node, edge
        FROM pgr_dijkstra(
            'SELECT id, source, target, cost, reverse_cost FROM road_single',
            (SELECT id FROM start_node),
            (SELECT id FROM end_node),
            directed := true
        )
    ),
    path AS (
        SELECT
            seq,
            node AS from_node,
            LEAD(node) OVER (ORDER BY seq) AS to_node,
            edge
        FROM path_raw
    ),
    ordered_edges AS (
        SELECT
            ROW_NUMBER() OVER (ORDER BY path.seq) AS edge_seq,
            CASE
                WHEN road_single.source = path.from_node AND road_single.target = path.to_node THEN road_single.geom
                WHEN road_single.target = path.from_node AND road_single.source = path.to_node THEN ST_Reverse(road_single.geom)
                ELSE road_single.geom
            END AS geom,
            road_single.cost
        FROM path
        JOIN road_single ON path.edge = road_single.id
        WHERE path.edge != -1 AND path.to_node IS NOT NULL
    ),
    path_points AS (
        SELECT
            ordered_edges.edge_seq,
            (dumped.path)[1] AS point_seq,
            dumped.geom AS geom
        FROM ordered_edges
        CROSS JOIN LATERAL ST_DumpPoints(ordered_edges.geom) AS dumped
        WHERE ordered_edges.edge_seq = 1 OR (dumped.path)[1] > 1
    ),
    route_line AS (
        SELECT ST_RemoveRepeatedPoints(
            ST_MakeLine(path_points.geom ORDER BY path_points.edge_seq, path_points.point_seq)
        ) AS geom
        FROM path_points
    ),
    route_stats AS (
        SELECT SUM(cost) AS total_distance
        FROM ordered_edges
    )
    SELECT
        route_line.geom,
        route_stats.total_distance
    INTO route_geom, distance
    FROM route_line
    CROSS JOIN route_stats;
    
    -- 如果没有找到路径，使用直线连接
    IF route_geom IS NULL THEN
        route_geom := ST_MakeLine(
            ST_SetSRID(ST_MakePoint(start_lon, start_lat), 4326),
            ST_SetSRID(ST_MakePoint(end_lon, end_lat), 4326)
        );
        distance := ST_Distance(
            ST_SetSRID(ST_MakePoint(start_lon, start_lat), 4326),
            ST_SetSRID(ST_MakePoint(end_lon, end_lat), 4326)
        );
    END IF;
    
    -- 计算预计时间
    time_estimate := (distance / 1000 / 42) * 60;
    
    RETURN QUERY
    SELECT route_geom, distance, time_estimate;
END;
$$ LANGUAGE plpgsql;

-- 4. 创建最终的API函数
CREATE OR REPLACE FUNCTION get_route_for_api(
    start_lon numeric, 
    start_lat numeric, 
    end_lon numeric, 
    end_lat numeric
)
RETURNS TABLE(
    route geometry,
    total_distance numeric,
    estimated_time numeric,
    method text
) AS $$
BEGIN
    -- 首先尝试使用pgRouting
    RETURN QUERY
    SELECT 
        route, 
        total_distance, 
        estimated_time, 
        'pgrouting'::text as method
    FROM get_route_using_pgrouting(start_lon, start_lat, end_lon, end_lat);
    
    -- 如果没有结果，使用简化方法
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 
            route, 
            total_distance, 
            estimated_time, 
            'simple'::text as method
        FROM get_route_simple(start_lon, start_lat, end_lon, end_lat);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 5. 测试路径规划函数
SELECT '=== 测试路径规划函数 ===' as test_name;

-- 测试1：使用用户提供的坐标
SELECT 
    ST_AsGeoJSON(route) as route_geojson,
    total_distance,
    estimated_time,
    method
FROM get_route_for_api(116.3975, 39.9087, 116.3971, 39.9178);

-- 测试2：使用其他坐标
SELECT 
    ST_AsGeoJSON(route) as route_geojson,
    total_distance,
    estimated_time,
    method
FROM get_route_for_api(116.3, 39.9, 116.4, 39.9);

-- 6. 创建路径规划详细信息函数
CREATE OR REPLACE FUNCTION get_route_details(
    start_lon numeric, 
    start_lat numeric, 
    end_lon numeric, 
    end_lat numeric
)
RETURNS TABLE(
    route geometry,
    total_distance numeric,
    estimated_time numeric,
    start_node_id integer,
    end_node_id integer,
    edge_count integer,
    nodes jsonb
) AS $$
DECLARE
    start_node_id integer;
    end_node_id integer;
    route_geom geometry;
    distance numeric;
    time_estimate numeric;
    node_info jsonb;
BEGIN
    -- 查找最近的起点节点
    SELECT id INTO start_node_id
    FROM road_single_vertices_pgr
    ORDER BY the_geom <-> ST_SetSRID(ST_MakePoint(start_lon, start_lat), 4326)
    LIMIT 1;
    
    -- 查找最近的终点节点
    SELECT id INTO end_node_id
    FROM road_single_vertices_pgr
    ORDER BY the_geom <-> ST_SetSRID(ST_MakePoint(end_lon, end_lat), 4326)
    LIMIT 1;
    
    -- 检查是否找到节点
    IF start_node_id IS NULL OR end_node_id IS NULL THEN
        RETURN QUERY
        SELECT NULL::geometry, 0::numeric, 0::numeric, NULL::integer, NULL::integer, 0::integer, '[]'::jsonb
        LIMIT 0;
        RETURN;
    END IF;
    
    -- 获取路径信息
    WITH path_raw AS (
        SELECT seq, node, edge
        FROM pgr_dijkstra(
            'SELECT id, source, target, cost, reverse_cost FROM road_single',
            start_node_id,
            end_node_id,
            directed := true
        )
    ),
    path AS (
        SELECT
            seq,
            node AS from_node,
            LEAD(node) OVER (ORDER BY seq) AS to_node,
            edge
        FROM path_raw
    ),
    ordered_edges AS (
        SELECT
            ROW_NUMBER() OVER (ORDER BY path.seq) AS edge_seq,
            path.seq,
            path.from_node AS node,
            path.edge,
            CASE
                WHEN road_single.source = path.from_node AND road_single.target = path.to_node THEN road_single.geom
                WHEN road_single.target = path.from_node AND road_single.source = path.to_node THEN ST_Reverse(road_single.geom)
                ELSE road_single.geom
            END AS geom,
            road_single.cost
        FROM path
        JOIN road_single ON path.edge = road_single.id
        WHERE path.edge != -1 AND path.to_node IS NOT NULL
    ),
    path_points AS (
        SELECT
            ordered_edges.edge_seq,
            (dumped.path)[1] AS point_seq,
            dumped.geom AS geom
        FROM ordered_edges
        CROSS JOIN LATERAL ST_DumpPoints(ordered_edges.geom) AS dumped
        WHERE ordered_edges.edge_seq = 1 OR (dumped.path)[1] > 1
    ),
    route_line AS (
        SELECT ST_RemoveRepeatedPoints(
            ST_MakeLine(path_points.geom ORDER BY path_points.edge_seq, path_points.point_seq)
        ) AS geom
        FROM path_points
    ),
    route_stats AS (
        SELECT
            SUM(cost) AS total_distance,
            COUNT(*) AS edge_count
        FROM ordered_edges
    ),
    path_nodes AS (
        SELECT jsonb_agg(
            jsonb_build_object(
                'seq', ordered_edges.seq,
                'node', ordered_edges.node,
                'edge', ordered_edges.edge
            )
            ORDER BY ordered_edges.seq
        ) AS node_info
        FROM ordered_edges
    )
    SELECT
        route_line.geom,
        route_stats.total_distance,
        route_stats.edge_count,
        path_nodes.node_info
    INTO route_geom, distance, edge_count, node_info
    FROM route_line
    CROSS JOIN route_stats
    CROSS JOIN path_nodes;
    
    -- 检查是否找到路径
    IF route_geom IS NULL THEN
        RETURN QUERY
        SELECT NULL::geometry, 0::numeric, 0::numeric, start_node_id, end_node_id, 0::integer, '[]'::jsonb
        LIMIT 0;
        RETURN;
    END IF;
    
    -- 计算预计时间
    time_estimate := (distance / 1000 / 42) * 60;
    
    RETURN QUERY
    SELECT route_geom, distance, time_estimate, start_node_id, end_node_id, edge_count, node_info;
END;
$$ LANGUAGE plpgsql;

-- 7. 测试详细路径信息
SELECT '=== 测试详细路径信息 ===' as test_name;

SELECT 
    ST_AsGeoJSON(route) as route_geojson,
    total_distance,
    estimated_time,
    start_node_id,
    end_node_id,
    edge_count,
    nodes
FROM get_route_details(116.3975, 39.9087, 116.3971, 39.9178);
