from flask import Flask, jsonify, request
from flask_cors import CORS
import json
import psycopg2
from psycopg2.extras import RealDictCursor


app = Flask(__name__)
CORS(app)


DB_PARAMS = {
    "dbname": "road",
    "user": "postgres",
    "password": "123456",
    "host": "localhost",
    "port": "5432",
}


SPEED_DEFAULT_SQL = """
CASE
    WHEN type LIKE '%高速%' OR type LIKE '%Highway%' OR type LIKE '%Expressway%' THEN 120
    WHEN type LIKE '%快速%' OR type LIKE '%Fast%' OR type LIKE '%Rapid%' THEN 80
    WHEN type LIKE '%主干%' OR type LIKE '%Main%' OR type LIKE '%Primary%' THEN 60
    WHEN type LIKE '%次干%' OR type LIKE '%Secondary%' THEN 50
    WHEN type LIKE '%支路%' OR type LIKE '%Branch%' OR type LIKE '%Local%' THEN 40
    ELSE 30
END
"""

TIME_COST_SQL = """
COALESCE(
    NULLIF(travel_time, 0),
    (ST_Length(geom::geography) / 1000.0 / GREATEST(COALESCE(NULLIF(speed, 0), 30), 1)) * 60.0
)
"""

DISTANCE_COST_SQL = "ST_Length(geom::geography)"

ROUTE_SQL_TEMPLATE = """
WITH
start_pt AS (
    SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS geom
),
end_pt AS (
    SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS geom
),
start_node AS (
    SELECT id
    FROM road_single_vertices_pgr
    ORDER BY the_geom <-> (SELECT geom FROM start_pt)
    LIMIT 1
),
end_node AS (
    SELECT id
    FROM road_single_vertices_pgr
    ORDER BY the_geom <-> (SELECT geom FROM end_pt)
    LIMIT 1
),
path_raw AS (
    SELECT seq, node, edge
    FROM pgr_dijkstra(
        $$SELECT id, source, target, {cost_expr} AS cost, {cost_expr} AS reverse_cost
          FROM road_single
          WHERE geom IS NOT NULL$$,
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
        ST_Length(road_single.geom::geography) AS edge_distance,
        {time_cost_expr} AS edge_time,
        NULLIF(road_single.speed, 0) AS speed
    FROM path
    JOIN road_single ON path.edge = road_single.id
    WHERE path.edge != -1 AND path.to_node IS NOT NULL AND road_single.geom IS NOT NULL
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
        SUM(edge_distance) AS total_distance,
        SUM(edge_time) AS total_time,
        AVG(speed) AS avg_speed,
        COUNT(*) AS edge_count
    FROM ordered_edges
)
SELECT
    ST_AsGeoJSON(route_line.geom) AS route,
    route_stats.total_distance,
    route_stats.total_time,
    route_stats.avg_speed,
    route_stats.edge_count
FROM route_line
CROSS JOIN route_stats
"""

ROUTE_COMPARE_SPECS = {
    "distance": {
        "route_key": "distance",
        "label": "距离最短",
        "cost_expr": DISTANCE_COST_SQL,
    },
    "time": {
        "route_key": "time",
        "label": "时间最短",
        "cost_expr": TIME_COST_SQL,
    },
}


def get_db_connection():
    try:
        conn = psycopg2.connect(**DB_PARAMS)
        ensure_speed_columns(conn)
        return conn
    except Exception as exc:
        print(f"database connection failed: {exc}")
        return None


def ensure_speed_columns(conn):
    try:
        with conn.cursor() as cur:
            cur.execute('ALTER TABLE "road_single" ADD COLUMN IF NOT EXISTS speed double precision;')
            cur.execute('ALTER TABLE "road_single" ADD COLUMN IF NOT EXISTS travel_time double precision;')
            cur.execute(
                f'''
                UPDATE "road_single"
                SET speed = {SPEED_DEFAULT_SQL}
                WHERE COALESCE(speed, 0) <= 0;
                '''
            )
            cur.execute(
                '''
                UPDATE "road_single"
                SET travel_time = (
                    ST_Length(geom::geography) / 1000.0 /
                    GREATEST(COALESCE(NULLIF(speed, 0), 30), 1)
                ) * 60.0
                WHERE geom IS NOT NULL;
                '''
            )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        print(f"failed to prepare speed fields: {exc}")


def as_float(value):
    if value is None:
        return None
    return float(value)


def parse_route_params():
    try:
        return (
            float(request.args.get("start_lon")),
            float(request.args.get("start_lat")),
            float(request.args.get("end_lon")),
            float(request.args.get("end_lat")),
        )
    except Exception as exc:
        raise ValueError(f"invalid params: {exc}") from exc


def execute_route_query(cur, start_lon, start_lat, end_lon, end_lat, cost_expr):
    sql = ROUTE_SQL_TEMPLATE.format(
        cost_expr=cost_expr,
        time_cost_expr=TIME_COST_SQL,
    )
    cur.execute(sql, (start_lon, start_lat, end_lon, end_lat))
    return cur.fetchone()


def build_route_payload(route_spec, row):
    if not row or not row["route"]:
        return None

    return {
        "route_key": route_spec["route_key"],
        "label": route_spec["label"],
        "route": json.loads(row["route"]),
        "distance": as_float(row["total_distance"]),
        "duration": as_float(row["total_time"]),
        "avg_speed": as_float(row["avg_speed"]),
        "edge_count": row["edge_count"],
    }


@app.route("/api/health", methods=["GET"])
def health_check():
    conn = get_db_connection()
    db_status = "connected" if conn else "disconnected"
    if conn:
        conn.close()

    return jsonify(
        {
            "status": "healthy",
            "service": "PostGIS route API",
            "database": db_status,
        }
    )


@app.route("/api/route", methods=["GET"])
def get_route():
    try:
        start_lon, start_lat, end_lon, end_lat = parse_route_params()
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400

    mode = request.args.get("mode", "time").strip().lower()
    route_spec = ROUTE_COMPARE_SPECS.get(mode)
    if route_spec is None:
        return jsonify({"status": "error", "message": "mode must be distance or time"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"status": "error", "message": "database connection failed"}), 500

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            row = execute_route_query(
                cur,
                start_lon,
                start_lat,
                end_lon,
                end_lat,
                route_spec["cost_expr"],
            )

        payload = build_route_payload(route_spec, row)
        if payload is None:
            return jsonify({"status": "error", "message": "route not found"}), 400

        return jsonify(
            {
                "status": "success",
                **payload,
                "query_info": {
                    "start": {"lon": start_lon, "lat": start_lat},
                    "end": {"lon": end_lon, "lat": end_lat},
                    "mode": mode,
                },
            }
        )
    except Exception as exc:
        print(f"route query failed: {exc}")
        return jsonify({"status": "error", "message": f"route query failed: {exc}"}), 500
    finally:
        conn.close()


@app.route("/api/multi-route", methods=["GET"])
def get_multi_route():
    try:
        start_lon, start_lat, end_lon, end_lat = parse_route_params()
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"status": "error", "message": "database connection failed"}), 500

    try:
        routes = []
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            for route_spec in ROUTE_COMPARE_SPECS.values():
                row = execute_route_query(
                    cur,
                    start_lon,
                    start_lat,
                    end_lon,
                    end_lat,
                    route_spec["cost_expr"],
                )
                payload = build_route_payload(route_spec, row)
                if payload is not None:
                    routes.append(payload)

        if not routes:
            return jsonify({"status": "error", "message": "routes not found"}), 400

        return jsonify(
            {
                "status": "success",
                "routes": routes,
                "route_count": len(routes),
                "query_info": {
                    "start": {"lon": start_lon, "lat": start_lat},
                    "end": {"lon": end_lon, "lat": end_lat},
                },
            }
        )
    except Exception as exc:
        print(f"multi-route query failed: {exc}")
        return jsonify({"status": "error", "message": f"multi-route query failed: {exc}"}), 500
    finally:
        conn.close()


if __name__ == "__main__":
    print("starting PostGIS route API service...")
    print(f"database: {DB_PARAMS['host']}:{DB_PARAMS['port']}/{DB_PARAMS['dbname']}")
    print("health: http://localhost:5000/api/health")
    print(
        "route sample: "
        "http://localhost:5000/api/route?"
        "start_lon=116.3975&start_lat=39.9087&end_lon=116.3971&end_lat=39.9178&mode=time"
    )
    print(
        "compare sample: "
        "http://localhost:5000/api/multi-route?"
        "start_lon=116.3975&start_lat=39.9087&end_lon=116.3971&end_lat=39.9178"
    )
    app.run(debug=True, host="0.0.0.0", port=5000)
