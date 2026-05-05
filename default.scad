// Global detail setting
$fn = 64;

// Animation Data Dictionary
// Subdividing 360-degree rotations into 90-degree increments to adhere to glTF shortest-path interpolation rules.
anim_data = [
    ["OuterRing", [
        // Rotates around the X-axis
        [0.0, [0, 0, 0]],
        [1.0, [90, 0, 0]],
        [2.0, [180, 0, 0]],
        [3.0, [270, 0, 0]],
        [4.0, [360, 0, 0]]
    ]],
    ["InnerRing", [
        // Rotates backwards around the Y-axis (relative to OuterRing)
        [0.0, [0, 0, 0]],
        [1.0, [0, -90, 0]],
        [2.0, [0, -180, 0]],
        [3.0, [0, -270, 0]],
        [4.0, [0, -360, 0]]
    ]],
    ["Gem", [
        // Rotates around the Z-axis while hovering up and down on the Z-axis
        [0.0, [0, 0, 0],   [0, 0, 0]],
        [1.0, [0, 0, 90],  [0, 0, 2]],
        [2.0, [0, 0, 180], [0, 0, 0]],
        [3.0, [0, 0, 270], [0, 0, -2]],
        [4.0, [0, 0, 360], [0, 0, 0]]
    ]]
];

// Root armature wrapping all animated and static components
armature(animations=anim_data) {
    
    // --- STATIC ENVIRONMENT ---
    
    // Polished dark wood base (using clearcoat for a varnished finish)
    color([0.15, 0.08, 0.03, 1.0], roughness=0.7, clearcoat=1.0, clearcoatRoughness=0.05) {
        cylinder(h=2, r=24);
        translate([0, 0, 2]) cylinder(h=1, r1=24, r2=22);
        translate([0, 0, 3]) cylinder(h=2, r=22);
    }

    // Velvet display cushion (using sheen for microfiber backscattering)
    translate([0, 0, 5.5])
    color([0.7, 0.05, 0.1, 1.0], roughness=0.9, sheen=1.0, sheenColor=[1.0, 0.4, 0.4], sheenRoughness=0.5)
        scale([1, 1, 0.3]) sphere(r=18);

    // Bronze support pillars (using high metalness)
    color([0.8, 0.6, 0.2, 1.0], metalness=1.0, roughness=0.2) {
        // Vertical stands
        translate([-17, 0, 15]) cylinder(h=22, r=1.5, center=true);
        translate([17, 0, 15]) cylinder(h=22, r=1.5, center=true);
        
        // Pivot caps locking the outer ring into place
        translate([-17, 0, 26]) rotate([0, 90, 0]) cylinder(h=4, r=1.2, center=true);
        translate([17, 0, 26]) rotate([0, 90, 0]) cylinder(h=4, r=1.2, center=true);
    }

    // --- ANIMATED MECHANISM HIERARCHY ---
    
    // 1. Outer Ring (Rotates via animation track)
    bone(name="OuterRing", t=[0,0,26]) {
        
        // Solid Gold Material
        color([1.0, 0.84, 0.0, 1.0], metalness=1.0, roughness=0.15) {
            rotate_extrude() translate([14, 0, 0]) circle(r=1.0);
            
            // Inner pins connecting the Outer Ring to the Inner Ring
            translate([0, 11.5, 0]) rotate([90, 0, 0]) cylinder(h=3, r=0.6, center=true);
            translate([0, -11.5, 0]) rotate([90, 0, 0]) cylinder(h=3, r=0.6, center=true);
        }

        // 2. Inner Ring (Child of Outer Ring, rotates relative to it)
        bone(name="InnerRing", t=[0,0,0]) {
            
            // Solid Silver Material
            color([0.9, 0.9, 0.95, 1.0], metalness=1.0, roughness=0.2) {
                rotate_extrude() translate([10, 0, 0]) circle(r=0.8);
            }

            // 3. Floating Gem (Child of Inner Ring)
            bone(name="Gem", t=[0,0,0]) {
                
                // Sapphire / Glass Material
                // Note: Alpha is strictly 1.0 since transmission provides the transparency. 
                // Thickness gives it a solid volumetric refraction rather than a thin bubble look.
                color([0.3, 0.6, 1.0, 1.0], transmission=0.95, roughness=0.0, thickness=4.0) {
                    
                    // Hexagonal faceted crystal shape
                    union() {
                        cylinder(h=5, r1=4, r2=0, $fn=6);
                        translate([0,0,-5]) cylinder(h=5, r1=0, r2=4, $fn=6);
                    }
                }
            }
        }
    }
}
