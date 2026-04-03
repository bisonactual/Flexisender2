(Test: square pocket 50x50mm in negative space, 3 depth passes)
G21 (metric)
G90 (absolute)

G0 Z5              (rapid to safe Z)
G0 X-10 Y-10       (rapid to start corner)

(Pass 1: Z-1)
G0 Z1
G1 Z-1 F200
G1 X-60 F800
G1 Y-60
G1 X-10
G1 Y-10

(Pass 2: Z-2)
G0 Z1
G0 X-60 Y-60       (rapid reposition to far corner)
G1 Z-2 F200
G1 X-10 F800
G1 Y-10
G1 X-60
G1 Y-60

(Pass 3: Z-3)
G0 Z1
G0 X-10 Y-10       (rapid back to start)
G1 Z-3 F200
G1 X-60 F800
G1 Y-60
G1 X-10
G1 Y-10

G0 Z5              (retract)
G0 X0 Y0           (rapid home)
M5
M30
