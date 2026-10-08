#!/bin/sh
# AWS Lambda (Lambda Web Adapter): arranca la API como en local; el adaptador le pasa las peticiones.
exec node src/server.ts
