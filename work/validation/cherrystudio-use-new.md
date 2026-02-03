输入 deepseek 并搜索

{
  "params": {
    "session_id": "u1",
    "argv": [
      "open",
      "https://www.google.com"
    ],
    "timeout_sec": 30
  },
  "response": {
    "content": [
      {
        "type": "text",
        "text": "{\"session_id\":\"u1\",\"subcommand\":\"open\",\"args\":[\"https://www.google.com\"],\"exit_code\":0,\"stdout\":\"{\\\"title\\\":\\\"Google\\\",\\\"url\\\":\\\"https://www.google.com/\\\"}\\n\",\"stderr\":\"\"}"
      }
    ]
  }
}


{
  "params": {
    "session_id": "u1",
    "argv": [
      "snapshot",
      "-i"
    ],
    "timeout_sec": 30
  },
  "response": {
    "content": [
      {
        "type": "text",
        "text": "{\"session_id\":\"u1\",\"subcommand\":\"snapshot\",\"args\":[\"-i\"],\"exit_code\":0,\"stdout\":\"{\\\"refs\\\":{\\\"e1\\\":{\\\"name\\\":\\\"About\\\",\\\"role\\\":\\\"link\\\"},\\\"e10\\\":{\\\"name\\\":\\\"Search by image\\\",\\\"role\\\":\\\"button\\\"},\\\"e11\\\":{\\\"name\\\":\\\"AI Mode\\\",\\\"role\\\":\\\"link\\\"},\\\"e12\\\":{\\\"name\\\":\\\"Google Search\\\",\\\"role\\\":\\\"button\\\"},\\\"e13\\\":{\\\"name\\\":\\\"I'm Feeling Lucky\\\",\\\"role\\\":\\\"button\\\"},\\\"e14\\\":{\\\"name\\\":\\\"Advertising\\\",\\\"role\\\":\\\"link\\\"},\\\"e15\\\":{\\\"name\\\":\\\"Business\\\",\\\"role\\\":\\\"link\\\"},\\\"e16\\\":{\\\"name\\\":\\\"How Search works\\\",\\\"role\\\":\\\"link\\\"},\\\"e17\\\":{\\\"name\\\":\\\"Applying AI towards science and the environment\\\",\\\"role\\\":\\\"link\\\"},\\\"e18\\\":{\\\"name\\\":\\\"Privacy\\\",\\\"role\\\":\\\"link\\\"},\\\"e19\\\":{\\\"name\\\":\\\"Terms\\\",\\\"role\\\":\\\"link\\\"},\\\"e2\\\":{\\\"name\\\":\\\"Store\\\",\\\"role\\\":\\\"link\\\"},\\\"e20\\\":{\\\"name\\\":\\\"Settings\\\",\\\"role\\\":\\\"button\\\"},\\\"e3\\\":{\\\"name\\\":\\\"Gmail\\\",\\\"role\\\":\\\"link\\\"},\\\"e4\\\":{\\\"name\\\":\\\"Search for Images\\\",\\\"role\\\":\\\"link\\\"},\\\"e5\\\":{\\\"name\\\":\\\"Google apps\\\",\\\"role\\\":\\\"button\\\"},\\\"e6\\\":{\\\"name\\\":\\\"Sign in\\\",\\\"role\\\":\\\"link\\\"},\\\"e7\\\":{\\\"name\\\":\\\"Upload files or images\\\",\\\"role\\\":\\\"button\\\"},\\\"e8\\\":{\\\"name\\\":\\\"Search\\\",\\\"role\\\":\\\"combobox\\\"},\\\"e9\\\":{\\\"name\\\":\\\"Search by voice\\\",\\\"role\\\":\\\"button\\\"}},\\\"snapshot\\\":\\\"- link \\\\\\\"About\\\\\\\" [ref=e1]\\\\n- link \\\\\\\"Store\\\\\\\" [ref=e2]\\\\n- link \\\\\\\"Gmail\\\\\\\" [ref=e3]\\\\n- link \\\\\\\"Search for Images\\\\\\\" [ref=e4]\\\\n- button \\\\\\\"Google apps\\\\\\\" [ref=e5]\\\\n- link \\\\\\\"Sign in\\\\\\\" [ref=e6]\\\\n- button \\\\\\\"Upload files or images\\\\\\\" [ref=e7]\\\\n- combobox \\\\\\\"Search\\\\\\\" [ref=e8]\\\\n- button \\\\\\\"Search by voice\\\\\\\" [ref=e9]\\\\n- button \\\\\\\"Search by image\\\\\\\" [ref=e10]\\\\n- link \\\\\\\"AI Mode\\\\\\\" [ref=e11]\\\\n- button \\\\\\\"Google Search\\\\\\\" [ref=e12]\\\\n- button \\\\\\\"I'm Feeling Lucky\\\\\\\" [ref=e13]\\\\n- link \\\\\\\"Advertising\\\\\\\" [ref=e14]\\\\n- link \\\\\\\"Business\\\\\\\" [ref=e15]\\\\n- link \\\\\\\"How Search works\\\\\\\" [ref=e16]\\\\n- link \\\\\\\"Applying AI towards science and the environment\\\\\\\" [ref=e17]\\\\n- link \\\\\\\"Privacy\\\\\\\" [ref=e18]\\\\n- link \\\\\\\"Terms\\\\\\\" [ref=e19]\\\\n- button \\\\\\\"Settings\\\\\\\" [ref=e20]\\\"}\\n\",\"stderr\":\"\"}"
      }
    ]
  }
}


{
  "params": {
    "session_id": "u1",
    "argv": [
      "fill",
      "@e8",
      "deepseek"
    ],
    "timeout_sec": 30
  },
  "response": {
    "content": [
      {
        "type": "text",
        "text": "{\"session_id\":\"u1\",\"subcommand\":\"fill\",\"args\":[\"@e8\",\"deepseek\"],\"exit_code\":0,\"stdout\":\"{\\\"filled\\\":true}\\n\",\"stderr\":\"\"}"
      }
    ]
  }
}


{
  "params": {
    "session_id": "u1",
    "argv": [
      "press",
      "Enter"
    ],
    "timeout_sec": 30
  },
  "response": {
    "content": [
      {
        "type": "text",
        "text": "{\"session_id\":\"u1\",\"subcommand\":\"press\",\"args\":[\"Enter\"],\"exit_code\":0,\"stdout\":\"{\\\"pressed\\\":true}\\n\",\"stderr\":\"\"}"
      }
    ]
  }
}


{
  "params": {
    "session_id": "u1",
    "argv": [
      "wait",
      "2000"
    ],
    "timeout_sec": 30
  },
  "response": {
    "content": [
      {
        "type": "text",
        "text": "{\"session_id\":\"u1\",\"subcommand\":\"wait\",\"args\":[\"2000\"],\"exit_code\":0,\"stdout\":\"{\\\"waited\\\":true}\\n\",\"stderr\":\"\"}"
      }
    ]
  }
}

