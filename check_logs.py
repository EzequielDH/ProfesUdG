import paramiko
import sys

host = '104.248.221.102'
user = 'root'
password = 'Sdkl346GD!ds'

def run_ssh():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(hostname=host, username=user, password=password, timeout=10)
        
        # Check logs
        cmd = 'journalctl -u profesudg -n 50 --no-pager'
        print(f"Executing: {cmd}")
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode('utf-8', errors='replace'))
        
        # Check if STRIPE_SECRET_KEY is really in the file
        cmd2 = 'cat /etc/systemd/system/profesudg.service | grep STRIPE'
        stdin, stdout, stderr = client.exec_command(cmd2)
        print("Env var grep:", stdout.read().decode('utf-8', errors='replace'))
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        client.close()

if __name__ == '__main__':
    run_ssh()
