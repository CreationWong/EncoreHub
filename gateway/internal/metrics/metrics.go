// Package metrics exposes Prometheus instrumentation for the gateway.
//
// Scrape with:  GET /metrics
// (always public, no auth — same convention as kube-prom and most agents).
package metrics

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	requestTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "encorehub_gateway_requests_total",
			Help: "Total HTTP requests handled by the gateway, partitioned by route and status code.",
		},
		[]string{"method", "route", "status"},
	)

	requestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "encorehub_gateway_request_duration_seconds",
			Help:    "Latency of gateway requests in seconds.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "route"},
	)

	inFlight = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "encorehub_gateway_in_flight_requests",
		Help: "Requests currently being processed by the gateway.",
	})
)

func init() {
	prometheus.MustRegister(requestTotal, requestDuration, inFlight)
}

// Middleware records counters/histograms for every request. Uses the matched
// gin route (e.g. /api/v1/conversations/:id) so cardinality stays bounded —
// raw paths with conversation UUIDs would explode the time-series count.
func Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		inFlight.Inc()
		start := time.Now()

		c.Next()

		route := c.FullPath()
		if route == "" {
			route = "unknown"
		}
		status := strconv.Itoa(c.Writer.Status())

		requestTotal.WithLabelValues(c.Request.Method, route, status).Inc()
		requestDuration.WithLabelValues(c.Request.Method, route).
			Observe(time.Since(start).Seconds())
		inFlight.Dec()
	}
}

// Handler returns a Gin handler that serves the Prometheus exposition format.
func Handler() gin.HandlerFunc {
	h := promhttp.Handler()
	return func(c *gin.Context) {
		h.ServeHTTP(c.Writer, c.Request)
	}
}
