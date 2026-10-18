#!/bin/bash
# usage: shot.sh "query" out.png  (dev server must run on 5199)
google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=1600,950 --virtual-time-budget=${3:-4000} --screenshot="$2" "http://localhost:5199/?demo&$1" 2>/dev/null
