{{- define "miroclone.image" -}}
{{ .root.Values.global.imageRegistry }}/{{ .svc.image }}:{{ .svc.tag }}
{{- end }}

{{- define "miroclone.labels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/part-of: miroclone
{{- end }}

{{/*
One workload: a Deployment and a Service. Parameters: root, name, svc, env (list of name/value maps),
secret (bool), caConfigMap (optional), probePath (empty for a TCP probe), preStop (bool).
*/}}
{{- define "miroclone.workload" -}}
{{- $root := .root -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .name }}
  labels:
    {{- include "miroclone.labels" . | nindent 4 }}
spec:
  {{- if not (and (hasKey $root.Values.autoscaling .name) (index $root.Values.autoscaling .name).enabled) }}
  replicas: {{ .svc.replicas }}
  {{- end }}
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ .name }}
  template:
    metadata:
      labels:
        {{- include "miroclone.labels" . | nindent 8 }}
    spec:
      serviceAccountName: miroclone
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      {{- with $root.Values.global.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- if .svc.terminationGracePeriodSeconds }}
      terminationGracePeriodSeconds: {{ .svc.terminationGracePeriodSeconds }}
      {{- end }}
      containers:
        - name: {{ .name }}
          image: {{ include "miroclone.image" (dict "root" $root "svc" .svc) }}
          ports:
            - name: http
              containerPort: {{ .svc.port }}
          {{- if .env }}
          env:
            {{- toYaml .env | nindent 12 }}
          {{- end }}
          {{- if .secret }}
          envFrom:
            - secretRef:
                name: {{ .name }}-secrets
          {{- end }}
          {{- if .probePath }}
          startupProbe:
            httpGet: { path: {{ .probePath }}, port: http }
            periodSeconds: 2
            failureThreshold: 30
          livenessProbe:
            httpGet: { path: {{ .probePath }}, port: http }
          readinessProbe:
            httpGet: { path: {{ .readyPath | default .probePath }}, port: http }
          {{- else }}
          startupProbe:
            tcpSocket: { port: http }
            periodSeconds: 2
            failureThreshold: 30
          livenessProbe:
            tcpSocket: { port: http }
          readinessProbe:
            tcpSocket: { port: http }
          {{- end }}
          {{- if .preStop }}
          lifecycle:
            preStop:
              sleep:
                seconds: {{ .svc.preStopSeconds }}
          {{- end }}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            {{- if .caConfigMap }}
            - name: ca
              mountPath: /etc/miroclone/ca
              readOnly: true
            {{- end }}
      volumes:
        - name: tmp
          emptyDir: {}
        {{- if .caConfigMap }}
        - name: ca
          configMap:
            name: {{ .caConfigMap }}
        {{- end }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  labels:
    {{- include "miroclone.labels" . | nindent 4 }}
spec:
  selector:
    app.kubernetes.io/name: {{ .name }}
  ports:
    - name: http
      port: {{ .svc.port }}
      targetPort: http
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ .name }}
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ .name }}
{{- end }}
