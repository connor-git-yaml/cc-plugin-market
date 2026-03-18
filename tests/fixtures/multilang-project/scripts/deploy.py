import os
import subprocess

def deploy():
    env = os.environ.get('DEPLOY_ENV', 'staging')
    subprocess.run(['echo', f'Deploying to {env}'])
