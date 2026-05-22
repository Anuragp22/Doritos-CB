import unittest

import numpy as np

from segment_cutout import build_cutout, tight_bbox


class TightBboxTest(unittest.TestCase):
    def test_bounds_the_nonzero_region(self):
        mask = np.zeros((10, 10), dtype=bool)
        mask[2:5, 3:7] = True  # rows 2-4, cols 3-6
        self.assertEqual(tight_bbox(mask), (3, 2, 7, 5))

    def test_empty_mask_raises(self):
        with self.assertRaises(ValueError):
            tight_bbox(np.zeros((4, 4), dtype=bool))


class BuildCutoutTest(unittest.TestCase):
    def test_crops_to_bbox_and_keeps_object_pixels(self):
        image = np.zeros((10, 10, 3), dtype=np.uint8)
        image[:, :, 0] = 200  # solid colour
        mask = np.zeros((10, 10), dtype=bool)
        mask[4:8, 1:5] = True  # 4 rows x 4 cols

        cutout = build_cutout(image, mask)

        self.assertEqual(cutout.size, (4, 4))  # PIL size is (width, height)
        arr = np.array(cutout)
        self.assertTrue((arr[:, :, 0] == 200).all())

    def test_background_outside_mask_is_white(self):
        image = np.zeros((6, 6, 3), dtype=np.uint8)  # black image
        mask = np.zeros((6, 6), dtype=bool)
        mask[1:5, 1:5] = True
        mask[2, 2] = False  # a hole inside the bbox

        cutout = build_cutout(image, mask)
        arr = np.array(cutout)
        self.assertTrue((arr[1, 1] == 255).all())  # the hole is white
        self.assertTrue((arr[0, 0] == 0).all())    # a kept pixel stays black

    def test_mismatched_shapes_raise(self):
        with self.assertRaises(ValueError):
            build_cutout(
                np.zeros((4, 4, 3), dtype=np.uint8),
                np.zeros((5, 5), dtype=bool),
            )


if __name__ == "__main__":
    unittest.main()
