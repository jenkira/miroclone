{{- define "miroclone.image" -}}
{{ .root.Values.global.imageRegistry }}/{{ .svc.image }}:{{ .svc.tag }}
{{- end }}

{{- define "miroclone.podSecurity" -}}
securityContext:
  runAsNonRoot: true
  seccompProfile:
    type: RuntimeDefault
{{- end }}

{{- define "miroclone.containerSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
{{- end }}
