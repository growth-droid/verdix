"""Rebuild everything: python run_all.py (from the folder holding these scripts)."""
import runpy
for s in ['sched2.py', 'finalize.py', 'hybrid_pc.py', 'write_meta.py']:
    print('==', s)
    runpy.run_path(s, run_name='__main__')
