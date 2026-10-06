# Google Ads campaign CLI

This read-only command lists campaigns for a Google Ads customer account. By
default it shows enabled campaigns whose primary status is `ELIGIBLE`, `LIMITED`,
or `LEARNING`. Use `--all` to include every campaign except removed campaigns
and inspect paused or otherwise non-serving campaigns.

## Setup

Run these commands from the `scripts` directory:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
```

Create a Google Ads API configuration file outside this repository, such as
`~/google-ads.yaml`, with the OAuth credentials and developer token issued for
your API access:

```yaml
developer_token: YOUR_DEVELOPER_TOKEN
client_id: YOUR_OAUTH_CLIENT_ID
client_secret: YOUR_OAUTH_CLIENT_SECRET
refresh_token: YOUR_OAUTH_REFRESH_TOKEN
use_proto_plus: true
```

All five keys must be at the root level. Keep this file private. The CLI resolves
the config in this order: `--config`,
`GOOGLE_ADS_CONFIGURATION_FILE_PATH`, then `~/google-ads.yaml`. When neither
config path is supplied, it uses Google's environment configuration if any
credential environment variable is set, such as `GOOGLE_ADS_CLIENT_ID`,
`GOOGLE_ADS_JSON_KEY_FILE_PATH`, or `GOOGLE_ADS_USE_APPLICATION_DEFAULT_CREDENTIALS`. See the
[Google Ads Python client configuration guide](https://developers.google.com/google-ads/api/docs/client-libs/python/configuration)
for supported credential environment variables and OAuth setup.

Set a default account ID, or pass one for each run:

```sh
export GOOGLE_ADS_CUSTOMER_ID=123-456-7890
python google.py
python google.py --customer-id 1234567890 --json
python google.py --all
```

For an account accessed through a manager account, pass its ID with
`--login-customer-id 111-222-3333`. The CLI sends SearchStream read requests
only; it does not change campaigns or account settings.
